import Phaser from 'phaser';
import './styles.css';
import { gameConfig } from './game/config';
import { getOperator, type OperatorRole } from './game/data/operators';
import { gameEvents, type MobileInputState } from './game/events';
import { GameServerClient } from './game/network/GameServerClient';
import { loadSettings, saveSettings } from './game/settings';
import { GameState, type ShelterModules } from './game/state/GameState';
import type { Mission } from './game/systems/MissionGenerator';
import type { PlayerProfile } from '../packages/shared/src/protocol';
import { describeSquadBonuses } from '../packages/shared/src/squad';
import { SoundEngine, type GameSfx } from './game/systems/SoundEngine';
import {
  operationDefinition, operationStageBrief, operationStageIndex,
  type OperationDefinition, type OperationId, type OperationStatus,
} from '../packages/shared/src/operations';
import {
  nearestWorldSector, nearestWorldStageSector, WORLD_SIZE, worldSectors, worldStageSectors,
} from '../packages/shared/src/world';
import { WEAPON_SPECS, type WeaponId } from '../packages/shared/src/combat';
import {
  RECRUIT_ODDS,
  STORE_PRODUCTS,
  type CommercePlatform,
  type StoreProductId,
} from '../packages/shared/src/commerce';
import { neuralLinkSkill } from '../packages/shared/src/neuralLink';
import { CLIENT_RELEASE } from './release';
import { installGlobalErrorReporting } from './game/telemetry/ClientTelemetry';
import {
  describeGearBonuses, GEAR_DEFINITIONS, GEAR_IDS, MAX_EQUIPPED_GEAR, type GearId,
} from '../packages/shared/src/gear';
import {
  initialRenderTier, type PerformanceSample,
} from './game/systems/PerformanceGovernor';
import { createDeepTalkFallback, operatorMemoryLimit } from '../packages/shared/src/persona';
import {
  buildContractBoard, type ContractBoard, type ContractCard, type ContractId, type ContractReward,
} from '../packages/shared/src/contracts';
import {
  parseTacticalCommand, type TacticalCommandFeedback, type TacticalOrder,
} from '../packages/shared/src/tactical';

declare global {
  interface Window {
    NeoBilling?: {
      getProducts(): Promise<Array<{ productId: StoreProductId; localizedPrice: string }>>;
      purchase(productId: StoreProductId): Promise<{ platform: CommercePlatform; receipt: string }>;
      restorePurchases(): Promise<Array<{ platform: CommercePlatform; productId: StoreProductId; receipt: string }>>;
    };
  }
}

const state = new GameState();
const mobileInput: MobileInputState = {
  up: false, down: false, left: false, right: false, fire: false, dash: false, extract: false,
};
const network = new GameServerClient();
let settings = loadSettings();
let performanceStatus: PerformanceSample = {
  tier: initialRenderTier(settings.graphicsQuality, navigator.maxTouchPoints > 0 || window.innerWidth < 820),
  fps: 0,
  changed: false,
};
const sound = new SoundEngine();
sound.setEnabled(settings.sound);
const game = new Phaser.Game(gameConfig);
game.registry.set('state', state);
game.registry.set('mobileInput', mobileInput);
game.registry.set('network', network);
game.registry.set('settings', settings);

const byId = <T extends Element>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as unknown as T;
};

const resourceHud = byId<HTMLDivElement>('resourceHud');
const squadHud = byId<HTMLElement>('squadHud');
const missionText = byId<HTMLDivElement>('missionText');
const serverStatus = byId<HTMLSpanElement>('serverStatus');
const hpText = byId<HTMLSpanElement>('hpText');
const hpBar = byId<HTMLElement>('hpBar');
const radiationText = byId<HTMLSpanElement>('radiationText');
const radiationBar = byId<HTMLElement>('radiationBar');
const operationCode = byId<HTMLElement>('operationCode');
const operationTitle = byId<HTMLElement>('operationTitle');
const operationObjective = byId<HTMLElement>('operationObjective');
const operationProgress = byId<HTMLElement>('operationProgress');
const operationCount = byId<HTMLElement>('operationCount');
const operationStageRail = byId<HTMLElement>('operationStageRail');
const operationAnnouncement = byId<HTMLElement>('operationAnnouncement');
const tacticalMap = byId<HTMLElement>('tacticalMap');
const mapDistrict = byId<HTMLElement>('mapDistrict');
const mapCoordinates = byId<HTMLElement>('mapCoordinates');
const mapDirective = byId<HTMLElement>('mapDirective');
const mapObjectives = byId<HTMLElement>('mapObjectives');
const mapPlayer = byId<HTMLElement>('mapPlayer');
const mapRouteLine = byId<SVGLineElement>('mapRouteLine');
const mapBearing = byId<HTMLElement>('mapBearing');
const mapTarget = byId<HTMLElement>('mapTarget');
const stageBanner = byId<HTMLElement>('stageBanner');
const stageBannerCode = byId<HTMLElement>('stageBannerCode');
const stageBannerDistrict = byId<HTMLElement>('stageBannerDistrict');
const stageBannerDirective = byId<HTMLElement>('stageBannerDirective');
const bossHud = byId<HTMLElement>('bossHud');
const bossHpProgress = byId<HTMLElement>('bossHpProgress');
const bossHpBar = byId<HTMLElement>('bossHpBar');
const bossHpText = byId<HTMLElement>('bossHpText');
const bossHudName = byId<HTMLElement>('bossHudName');
const eventFeed = byId<HTMLDivElement>('eventFeed');
const modalBackdrop = byId<HTMLDivElement>('modalBackdrop');
const modalContent = byId<HTMLDivElement>('modalContent');
const closeModalButton = byId<HTMLButtonElement>('closeModal');
const modalBackgroundRegions = [
  document.querySelector<HTMLElement>('.topbar'),
  document.querySelector<HTMLElement>('#game-shell'),
  document.querySelector<HTMLElement>('.command-dock'),
  document.querySelector<HTMLElement>('.mobile-controls'),
].filter((element): element is HTMLElement => element !== null);
const commandForm = byId<HTMLFormElement>('commandForm');
const commandInput = byId<HTMLInputElement>('commandInput');
const tacticalMenuButton = byId<HTMLButtonElement>('tacticalMenuButton');
const tacticalTriggerLabel = byId<HTMLElement>('tacticalTriggerLabel');
const tacticalPalette = byId<HTMLElement>('tacticalPalette');
const closeTacticalPaletteButton = byId<HTMLButtonElement>('closeTacticalPalette');
const tacticalStatus = byId<HTMLElement>('tacticalStatus');
const tacticalStatusSource = byId<HTMLElement>('tacticalStatusSource');
const tacticalStatusLabel = byId<HTMLElement>('tacticalStatusLabel');
const tacticalStatusDetail = byId<HTMLElement>('tacticalStatusDetail');
const tacticalStatusProgress = byId<HTMLElement>('tacticalStatusProgress');
const toast = byId<HTMLDivElement>('toast');
const storeButton = byId<HTMLButtonElement>('storeButton');
const releaseBadge = byId<HTMLElement>('releaseBadge');
const neuralLinkButton = byId<HTMLButtonElement>('neuralLinkButton');
const neuralLinkPortrait = byId<HTMLImageElement>('neuralLinkPortrait');
const neuralLinkSkillText = byId<HTMLElement>('neuralLinkSkill');
const neuralLinkBar = byId<HTMLElement>('neuralLinkBar');
const neuralLinkChargeText = byId<HTMLElement>('neuralLinkCharge');
const neuralCutin = byId<HTMLElement>('neuralCutin');
const neuralCutinPortrait = byId<HTMLImageElement>('neuralCutinPortrait');
const neuralCutinSkill = byId<HTMLElement>('neuralCutinSkill');
const neuralCutinName = byId<HTMLElement>('neuralCutinName');
const neuralCutinLine = byId<HTMLElement>('neuralCutinLine');
const bossIntro = byId<HTMLElement>('bossIntro');
const bossIntroName = byId<HTMLElement>('bossIntroName');
const bossIntroClass = byId<HTMLElement>('bossIntroClass');
const bossIntroDirective = byId<HTMLElement>('bossIntroDirective');
const dodgeButton = byId<HTMLButtonElement>('dodgeButton');
const contractBadge = byId<HTMLElement>('contractBadge');
let currentModal: 'shelter' | 'contracts' | 'roster' | 'deep-talk' | 'store' | 'alpha' | 'settings' | 'privacy' | 'tutorial' | 'game-over' | 'operation-complete' | null = null;
let rosterSelection: string | null = null;
let squadDraft: string[] = [];
let latestProfile: PlayerProfile | null = null;
let syncingAiConsent = false;
const talkHistory = new Map<string, Array<{
  role: 'player' | 'operator';
  text: string;
  source?: 'ai' | 'rules';
}>>();
const talkUsage = new Map<string, { used: number; limit: number }>();
let latestContractBoard: ContractBoard | null = null;
let currentLinkLeader = '';
let cutinTimer = 0;
let bossIntroTimer = 0;
let stageBannerTimer = 0;
let tacticalStageKey = '';
let tacticalMapKey = '';
let lastFocusedElement: HTMLElement | null = null;
let tacticalStatusTicker = 0;

type TacticalDisplayMode = 'pending' | 'active' | 'cooldown' | 'blocked' | 'error';
interface TacticalDisplayState {
  mode: TacticalDisplayMode;
  order: TacticalOrder;
  message: string;
  source: 'local' | 'server';
  startedAt: number;
  endsAt: number;
}
let tacticalDisplayState: TacticalDisplayState | null = null;

releaseBadge.textContent = `${CLIENT_RELEASE.channel.toUpperCase()} ${CLIENT_RELEASE.version}`;
releaseBadge.title = '비공개 테스트 빌드';
document.body.dataset.releaseChannel = CLIENT_RELEASE.channel;
storeButton.classList.toggle('hidden', !CLIENT_RELEASE.commerceEnabled);

const labels = { scrap: '고철', water: '식수', data: '데이터', cores: '코어' } as const;
const icons = { scrap: '▰', water: '◒', data: '◇', cores: '◈' } as const;
const compassDirections = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'] as const;
const tacticalOrderLabels: Record<TacticalOrder, string> = {
  DRAW_AGGRO: '도발',
  FLANK: '우회',
  HOLD: '엄폐',
  REGROUP: '집결',
  HEAL: '회복',
  FOCUS: '집중',
  SCAVENGE: '회수',
  UNKNOWN: '미확인',
};
const roleMetrics: Record<OperatorRole, Array<{ label: string; value: number }>> = {
  Vanguard: [{ label: '돌파', value: 88 }, { label: '방어', value: 92 }, { label: '지원', value: 42 }],
  Sniper: [{ label: '화력', value: 96 }, { label: '기동', value: 58 }, { label: '지원', value: 45 }],
  Support: [{ label: '화력', value: 48 }, { label: '생존', value: 76 }, { label: '지원', value: 95 }],
  Engineer: [{ label: '화력', value: 62 }, { label: '회수', value: 94 }, { label: '지원', value: 78 }],
};
const tutorialSteps = [
  {
    code: '01 // PURPOSE', icon: 'N//E', title: '이 게임에서 무엇을 하나요?',
    body: '3인 오퍼레이터 분대를 이끌고 레드 존을 탐사해 자원을 회수하는 전술 생존 게임입니다. 전투만 잘하는 것보다 언제 더 모으고 언제 철수할지 판단하는 것이 중요합니다.',
    utility: '5~10분 단위의 짧은 탐사에서 전술 판단, 수집, 성장의 재미를 반복해서 즐길 수 있습니다.',
    tip: '핵심 루프는 탐사 → 전술 대응 → 안전 추출 → 쉘터 성장입니다. 첫 목표는 자원 8개를 모아 살아서 돌아오는 것입니다.',
    keys: ['EXPLORE', 'DECIDE', 'EXTRACT'],
  },
  {
    code: '02 // CONTROL', icon: '⌖', title: '살아남는 기본 조작',
    body: 'PC는 WASD와 마우스, 모바일은 방향 패드와 FIRE, 게임패드는 양쪽 스틱을 사용합니다. Space 또는 DODGE로 1.8초마다 위험 지역을 빠르게 벗어날 수 있습니다.',
    utility: 'PC·모바일·게임패드 어디서든 같은 저장 흐름과 전투 규칙으로 플레이할 수 있습니다.',
    tip: '한자리에 오래 머물면 적응형 디렉터가 우회 병력을 보냅니다. 사격하면서 원을 그리듯 계속 이동하세요.',
    keys: ['WASD', 'AIM', 'FIRE', 'DODGE'],
  },
  {
    code: '03 // NAVIGATION', icon: '△', title: '전술 지도로 다음 구역을 찾으세요',
    body: '우측 전술 지도에서 빛나는 목표점, 현재 위치와 목표를 잇는 경로선, 방향 화살표와 거리를 확인하세요. 상단 스테이지 레일은 이번 작전의 전체 흐름과 현재 단계를 보여줍니다.',
    utility: '넓은 레드 존에서도 헤매지 않고 현재 단계에 맞는 자원 지대·중계기·보스 구역·추출 지점으로 이동할 수 있습니다.',
    tip: '목표가 여러 개면 가장 가까운 활성 구역이 자동 선택됩니다. 중계기를 파괴하면 남은 목표 중 가장 가까운 지점으로 즉시 갱신됩니다.',
    keys: ['MAP', 'ROUTE', 'DISTANCE', 'STAGE'],
  },
  {
    code: '04 // LOADOUT', icon: '⌁', title: '상황에 맞춰 무장을 바꾸세요',
    body: '카빈은 안정적인 중거리 전투, 파쇄포는 근접 돌파, 코일건은 장거리 정밀 사격에 특화되어 있습니다. 전투 중에도 즉시 교체할 수 있습니다.',
    utility: '적의 종류와 거리에 따라 무기를 바꾸면 같은 분대도 전혀 다른 방식으로 운용할 수 있습니다.',
    tip: '빠른 드론에는 카빈, 몰려오는 적에는 파쇄포, 체력이 높은 지휘 유닛에는 코일건이 효율적입니다.',
    keys: ['1 CARBINE', '2 SCATTER', '3 COIL'],
  },
  {
    code: '05 // COMMAND', icon: '◇', title: '말로 분대를 지휘하세요',
    body: '하단 TACTICAL 입력창에 “모두 복귀해”, “치료해줘”, “오른쪽으로 우회해”, “강한 적을 집중 공격해”처럼 자연스럽게 입력하면 분대 행동이 즉시 바뀝니다.',
    utility: '복잡한 단축키 없이 자연어로 집결·치료·우회·집중 공격 전술을 실행할 수 있습니다.',
    tip: '분대가 흩어졌다면 “모두 내 쪽으로 복귀”를 먼저 사용하고, 보스전에서는 “강한 적 집중 공격”으로 화력을 모으세요.',
    keys: ['REGROUP', 'HEAL', 'FLANK', 'FOCUS'],
  },
  {
    code: '06 // NEURAL LINK', icon: '◉', title: '분대 조합을 필살기로 연결하세요',
    body: '교전으로 링크 게이지를 100% 채운 뒤 Q 또는 리더 초상화를 누르면 1번 슬롯 오퍼레이터의 역할별 뉴럴 링크가 발동합니다.',
    utility: '분대 리더를 바꿔 방어, 화력, 회복, 기동 중심의 서로 다른 빌드를 만들 수 있습니다.',
    tip: '보스 등장 직전까지 게이지를 아껴두고, 오퍼레이터 화면에서 원하는 리더를 1번 슬롯에 배치하세요.',
    keys: ['LEADER SLOT', '100%', 'Q'],
  },
  {
    code: '07 // RISK', icon: '⬡', title: '욕심과 추출 사이를 판단하세요',
    body: '모은 현장 화물은 중앙 리프트에서 E 또는 EXTRACT를 눌러야 계정 자원이 됩니다. 쓰러지면 이번 탐사에서 모은 화물을 잃습니다.',
    utility: '안전한 소규모 수익과 위험한 고수익 탐사를 스스로 선택하는 리스크·리워드 플레이가 가능합니다.',
    tip: '체력이 40% 아래거나 방사능이 상승 중이면 추가 전투보다 추출을 우선하세요. 보라색 데이터는 희귀하지만 욕심은 금물입니다.',
    keys: ['CARGO', 'E', 'EXTRACT'],
  },
  {
    code: '08 // GROWTH', icon: '▣', title: '회수 자원을 영구 전력으로 바꾸세요',
    body: '쉘터 모듈을 업그레이드하면 오프라인 생산량이 늘고, 작업장에서 영구 전술 장비를 제작해 최대 2개까지 장착할 수 있습니다.',
    utility: '플레이하지 않는 시간에도 자원이 쌓이며, 원하는 생존·화력·회수 특성에 맞춰 장기 성장 경로를 설계할 수 있습니다.',
    tip: '초반에는 작업장과 정수 시설을 먼저 올리고, 첫 장비는 생존 보정 효과를 우선하면 탐사 성공률이 크게 높아집니다.',
    keys: ['SHELTER', 'UPGRADE', 'GEAR'],
  },
  {
    code: '09 // OPERATIVES', icon: '◈', title: '오퍼레이터를 수집하고 편성하세요',
    body: '오퍼레이터마다 역할, 희귀도, 뉴럴 링크, 관계 수치가 다릅니다. 3명을 편성해 역할 조합 보너스를 만들고 딥 토크에서 개인 서사와 기억을 확인할 수 있습니다.',
    utility: '전투 성능을 위한 편성과 캐릭터 관계·스토리 수집을 한 화면에서 함께 즐길 수 있습니다.',
    tip: 'Vanguard·Engineer·Support 조합은 초반 생존과 자원 회수의 균형이 좋습니다. 외부 AI 대화는 별도 동의가 있을 때만 사용됩니다.',
    keys: ['ROSTER', 'FORMATION', 'DEEP TALK'],
  },
  {
    code: '10 // ROUTINE', icon: '◆', title: '계약과 오프라인 보상으로 이어가세요',
    body: '일일 3개·주간 2개의 서버 검증 계약을 달성해 보상을 직접 수령하세요. 쉘터는 접속하지 않은 동안에도 최대 8시간 자원을 생산합니다.',
    utility: '매일 짧게 접속해도 명확한 목표와 성장 보상을 얻을 수 있고, 주간 목표는 장기 플레이 방향을 제시합니다.',
    tip: '게임을 시작하면 먼저 계약 보드를 확인하고, 이미 진행 중인 목표에 맞춰 무기와 탐사 전략을 고르세요.',
    keys: ['DAILY', 'WEEKLY', 'CLAIM'],
  },
  {
    code: '11 // ACCESS', icon: '◎', title: '나에게 맞는 방식으로 플레이하세요',
    body: '설정에서 HUD 크기, 고대비·적록 보정, 모션 감소, 그래픽 품질, 사운드와 진동을 조절할 수 있습니다. 필드 가이드는 하단 버튼에서 언제든 다시 열 수 있습니다.',
    utility: '시각·움직임 민감도와 기기 성능에 맞춰 인터페이스를 조절하면서 동일한 게임 진행을 유지할 수 있습니다.',
    tip: '화면이 복잡하면 HUD를 크게 하고 모션 감소를 켜세요. 개인정보와 외부 AI 사용 여부도 설정에서 언제든 변경할 수 있습니다.',
    keys: ['SETTINGS', 'ACCESSIBILITY', 'FIELD GUIDE'],
  },
] as const;

function renderPersistentHud(): void {
  const save = state.snapshot();
  const contractBoard = buildContractBoard(save.contracts);
  const claimableContracts = [...contractBoard.daily, ...contractBoard.weekly]
    .filter((contract) => contract.completed && !contract.claimed).length;
  contractBadge.textContent = String(claimableContracts);
  contractBadge.classList.toggle('hidden', claimableContracts === 0);
  const equippedGear = save.gear.equipped.map((gearId) => GEAR_DEFINITIONS[gearId]);
  resourceHud.innerHTML = (Object.keys(labels) as Array<keyof typeof labels>).map((key) =>
    `<div class="resource"><span>${icons[key]} ${labels[key]}</span><b>${save.resources[key].toLocaleString()}</b></div>`,
  ).join('');
  squadHud.innerHTML = `<div class="squad-title">SQUAD // NEURAL LINK</div>${state.getSquad().map(({ definition, owned }) => `
    <div class="operative-chip">
      <img class="op-avatar" src="${definition.portrait}" alt="${definition.name}" loading="eager" />
      <div><b>${definition.callsign}</b><small>${definition.role} · LINK ${owned.bond}%</small></div>
      <span class="rarity ${definition.rarity}">${definition.rarity}</span>
    </div>`).join('')}${equippedGear.length ? `<div class="field-loadout"><span>GEAR // ${equippedGear.length}/${MAX_EQUIPPED_GEAR}</span>${equippedGear.map((gear) =>
    `<i title="${gear.name} // ${gear.effectLabel}">${gear.mark}</i>`).join('')}</div>` : ''}`;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function setTacticalPaletteOpen(open: boolean, restoreFocus = false): void {
  tacticalPalette.classList.toggle('hidden', !open);
  tacticalMenuButton.setAttribute('aria-expanded', String(open));
  if (open) {
    window.requestAnimationFrame(() => {
      tacticalPalette.querySelector<HTMLButtonElement>('[data-tactical-command]')?.focus();
    });
  } else if (restoreFocus) {
    tacticalMenuButton.focus();
  }
}

function resetTacticalStatus(): void {
  tacticalDisplayState = null;
  window.clearInterval(tacticalStatusTicker);
  tacticalStatusTicker = 0;
  tacticalStatus.dataset.state = 'idle';
  tacticalMenuButton.dataset.state = 'idle';
  tacticalTriggerLabel.textContent = '전술';
  tacticalStatusSource.textContent = 'LINK STANDBY';
  tacticalStatusLabel.textContent = '분대 명령 대기';
  tacticalStatusDetail.textContent = '자연어를 입력하거나 빠른 명령을 선택하세요.';
  tacticalStatusProgress.style.width = '0%';
  tacticalMenuButton.setAttribute('aria-label', '빠른 전술 명령 열기');
  tacticalPalette.querySelectorAll<HTMLButtonElement>('[data-tactical-command]').forEach((button) => {
    button.disabled = false;
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });
}

function renderTacticalStatus(): void {
  const state = tacticalDisplayState;
  if (!state) {
    resetTacticalStatus();
    return;
  }
  const now = Date.now();
  if (state.endsAt <= now) {
    if (state.mode === 'pending') {
      tacticalDisplayState = {
        ...state,
        mode: 'error',
        message: '전술 링크 응답이 지연되고 있습니다. 연결 상태를 확인한 뒤 다시 시도하세요.',
        startedAt: now,
        endsAt: now + 4_500,
      };
      renderTacticalStatus();
      return;
    }
    resetTacticalStatus();
    return;
  }
  const label = tacticalOrderLabels[state.order];
  const remainingMs = Math.max(0, state.endsAt - now);
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1_000));
  const timed = state.mode === 'active' || state.mode === 'cooldown' || state.mode === 'blocked';
  const statusLabels: Record<TacticalDisplayMode, string> = {
    pending: `${label} 명령 송신`,
    active: `${label} 전술 적용`,
    cooldown: `${label} 완료`,
    blocked: `${label} 재충전`,
    error: `${label} 명령 거부`,
  };
  tacticalStatus.dataset.state = state.mode;
  tacticalMenuButton.dataset.state = state.mode;
  tacticalStatusSource.textContent = `${state.source === 'server' ? 'SERVER AUTH' : 'LOCAL CORE'} // ${state.order}`;
  tacticalStatusLabel.textContent = statusLabels[state.mode];
  const detailMessage = timed ? state.message.replace(/\s*\/\/\s*\d+초\s*$/, '') : state.message;
  tacticalStatusDetail.textContent = timed ? `${detailMessage} · ${remainingSeconds}초` : detailMessage;
  tacticalTriggerLabel.textContent = timed ? `${label} ${remainingSeconds}` : state.mode === 'pending' ? `${label}…` : '재시도';
  tacticalMenuButton.setAttribute('aria-label', `${statusLabels[state.mode]}. ${tacticalStatusDetail.textContent}`);
  const totalMs = Math.max(1, state.endsAt - state.startedAt);
  tacticalStatusProgress.style.width = state.mode === 'pending'
    ? '52%'
    : `${Math.max(0, Math.min(100, remainingMs / totalMs * 100))}%`;
  tacticalPalette.querySelectorAll<HTMLButtonElement>('[data-tactical-command]').forEach((button) => {
    const selected = button.dataset.tacticalOrder === state.order;
    button.classList.toggle('active', selected && state.mode !== 'error');
    button.setAttribute('aria-pressed', String(selected && state.mode !== 'error'));
    button.disabled = selected && (state.mode === 'cooldown' || state.mode === 'blocked');
  });
}

function beginTacticalStatus(order: TacticalOrder): void {
  const now = Date.now();
  tacticalDisplayState = {
    mode: 'pending',
    order,
    message: network.connected ? '서버 권위 판정을 기다리는 중입니다.' : '로컬 전술 코어가 명령을 해석하는 중입니다.',
    source: network.connected ? 'server' : 'local',
    startedAt: now,
    endsAt: now + 8_500,
  };
  if (!tacticalStatusTicker) tacticalStatusTicker = window.setInterval(renderTacticalStatus, 250);
  renderTacticalStatus();
}

function applyTacticalFeedback(feedback: TacticalCommandFeedback): void {
  const now = Date.now();
  const cooldownMs = Math.max(0, feedback.cooldownMs ?? 0);
  const durationMs = Math.max(0, feedback.durationMs ?? 0);
  const mode: TacticalDisplayMode = cooldownMs > 0
    ? feedback.applied ? 'cooldown' : 'blocked'
    : feedback.applied ? 'active' : 'error';
  const displayMs = cooldownMs || durationMs || 4_500;
  tacticalDisplayState = {
    mode,
    order: feedback.order,
    message: feedback.message,
    source: feedback.source,
    startedAt: now,
    endsAt: now + displayMs,
  };
  if (!tacticalStatusTicker) tacticalStatusTicker = window.setInterval(renderTacticalStatus, 250);
  renderTacticalStatus();
  showToast(feedback.message);
}

function dispatchTacticalCommand(command: string): void {
  const normalized = command.trim();
  if (!normalized) return;
  const parsed = parseTacticalCommand(normalized);
  beginTacticalStatus(parsed.order);
  gameEvents.emit('tactical-command', normalized);
  network.sendTactical(normalized);
  commandInput.value = '';
  commandInput.blur();
  setTacticalPaletteOpen(false);
}

function showNeuralCutin(operatorId: string, skillName: string): void {
  const operator = getOperator(operatorId);
  const skill = neuralLinkSkill(operatorId);
  window.clearTimeout(cutinTimer);
  neuralCutin.style.setProperty('--link-color', `#${skill.color.toString(16).padStart(6, '0')}`);
  neuralCutinPortrait.src = operator.portrait;
  neuralCutinPortrait.alt = `${operator.name} 뉴럴 링크 컷인`;
  neuralCutinSkill.textContent = skillName;
  neuralCutinName.textContent = `${operator.callsign} // ${operator.name}`;
  neuralCutinLine.textContent = `“${operator.combatLine}”`;
  neuralCutin.setAttribute('aria-hidden', 'false');
  neuralCutin.classList.remove('active');
  void neuralCutin.offsetWidth;
  neuralCutin.classList.add('active');
  cutinTimer = window.setTimeout(() => {
    neuralCutin.classList.remove('active');
    neuralCutin.setAttribute('aria-hidden', 'true');
  }, settings.reducedMotion ? 850 : 2200);
}

function showBossIntro(definition: OperationDefinition = operationDefinition('operation-zero')): void {
  window.clearTimeout(bossIntroTimer);
  bossIntroName.textContent = definition.bossName;
  bossIntroClass.textContent = definition.bossClass;
  bossIntroDirective.textContent = definition.bossDirective;
  bossIntro.setAttribute('aria-hidden', 'false');
  bossIntro.classList.remove('active');
  void bossIntro.offsetWidth;
  bossIntro.classList.add('active');
  bossIntroTimer = window.setTimeout(() => {
    bossIntro.classList.remove('active');
    bossIntro.setAttribute('aria-hidden', 'true');
  }, settings.reducedMotion ? 900 : 2600);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function addFeed(message: string, danger = false): void {
  const now = Date.now();
  const previous = eventFeed.firstElementChild as HTMLElement | null;
  if (previous?.dataset.message === message && now - Number(previous.dataset.updatedAt ?? 0) < 3_000) {
    const count = Number(previous.dataset.repeatCount ?? 1) + 1;
    previous.dataset.repeatCount = String(count);
    previous.dataset.updatedAt = String(now);
    previous.textContent = `> ${message} ×${count}`;
    if (danger) previous.classList.add('danger');
    return;
  }
  const line = document.createElement('div');
  line.textContent = `> ${message}`;
  if (danger) line.className = 'danger';
  line.dataset.message = message;
  line.dataset.repeatCount = '1';
  line.dataset.updatedAt = String(now);
  eventFeed.prepend(line);
  while (eventFeed.children.length > 5) eventFeed.lastElementChild?.remove();
}

const modalFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function modalFocusableElements(): HTMLElement[] {
  return [...modalBackdrop.querySelectorAll<HTMLElement>(modalFocusableSelector)]
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
}

function setModalBackgroundInert(active: boolean): void {
  modalBackgroundRegions.forEach((region) => {
    region.inert = active;
    if (active) region.setAttribute('aria-hidden', 'true');
    else region.removeAttribute('aria-hidden');
  });
}

function pauseForModal(): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && !modalBackdrop.contains(focused)) lastFocusedElement = focused;
  setTacticalPaletteOpen(false);
  window.clearTimeout(stageBannerTimer);
  stageBanner.classList.remove('active');
  stageBanner.setAttribute('aria-hidden', 'true');
  gameEvents.emit('suspend-world-input');
  if (game.scene.isActive('WorldScene')) game.scene.pause('WorldScene');
  setModalBackgroundInert(true);
  modalBackdrop.setAttribute('aria-hidden', 'false');
  modalBackdrop.classList.remove('hidden');
  window.requestAnimationFrame(() => closeModalButton.focus());
}

function closeModal(): void {
  const closing = currentModal;
  if (currentModal === 'tutorial' && !settings.tutorialComplete) {
    settings = { ...settings, tutorialComplete: true };
    applySettings();
    void network.track('tutorial_complete', { steps: tutorialSteps.length, skipped: true });
  }
  if (currentModal === 'privacy' && !settings.consentReviewed) {
    settings = { ...settings, consentReviewed: true, analyticsConsent: false };
    applySettings();
  }
  modalBackdrop.classList.add('hidden');
  modalBackdrop.setAttribute('aria-hidden', 'true');
  setModalBackgroundInert(false);
  currentModal = null;
  sound.play('ui');
  gameEvents.emit('resume-world');
  const focusTarget = lastFocusedElement;
  lastFocusedElement = null;
  window.requestAnimationFrame(() => {
    if (focusTarget?.isConnected) focusTarget.focus();
  });
  if (closing === 'privacy' && !settings.tutorialComplete) window.setTimeout(() => renderTutorial(0), 180);
}

function applySettings(): void {
  saveSettings(settings);
  sound.setEnabled(settings.sound);
  game.sound.mute = !settings.sound;
  game.registry.set('settings', settings);
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.body.classList.remove('ui-compact', 'ui-large', 'vision-deuteranopia', 'vision-high-contrast');
  if (settings.uiScale !== 'standard') document.body.classList.add(`ui-${settings.uiScale}`);
  if (settings.colorVision !== 'standard') document.body.classList.add(`vision-${settings.colorVision}`);
  byId<HTMLButtonElement>('muteButton').textContent = settings.sound ? 'SFX ON' : 'SFX OFF';
  network.setAnalyticsConsent(settings.analyticsConsent);
  gameEvents.emit('settings-changed', settings);
}

async function syncAiConsent(): Promise<void> {
  if (!network.connected || syncingAiConsent) return;
  const serverConsent = Boolean(latestProfile?.ai?.consentedAt);
  if (serverConsent === settings.aiConsent) return;
  syncingAiConsent = true;
  try {
    await network.setAiConsent(settings.aiConsent);
  } catch {
    showToast('AI 동의 상태를 서버와 동기화하지 못했습니다.');
  } finally {
    syncingAiConsent = false;
  }
}

function renderSettings(): void {
  currentModal = 'settings';
  pauseForModal();
  const toggles: Array<{ key: 'sound' | 'haptics' | 'reducedMotion' | 'analyticsConsent' | 'aiConsent'; label: string; description: string }> = [
    { key: 'sound', label: '전투 사운드', description: '사격, 타격, 환경 경보와 UI 합성음을 재생합니다.' },
    { key: 'haptics', label: '모바일 진동', description: '사격, 피격, 획득과 추출 순간에 촉각 피드백을 제공합니다.' },
    { key: 'reducedMotion', label: '모션 감소', description: '화면 흔들림과 전투 파티클 수를 줄여 멀미와 발열을 완화합니다.' },
    { key: 'analyticsConsent', label: '선택 분석 데이터', description: '개인 대화 내용 없이 진행·오류 이벤트만 전송합니다. 언제든 끌 수 있습니다.' },
    { key: 'aiConsent', label: '외부 AI 딥 토크', description: '직접 입력한 대화만 서버 중계를 통해 외부 AI에 전송합니다. 원문은 분석 이벤트에 사용하지 않습니다.' },
  ];
  modalContent.innerHTML = `
    <span class="eyebrow">SYSTEM CONFIG // DEVICE PROFILE</span>
    <h2>작전 환경 설정</h2>
    <p class="subtle">설정은 현재 기기에 즉시 저장됩니다.</p>
    <div class="settings-list">${toggles.map((toggle) => `
      <button class="setting-row" data-setting="${toggle.key}" role="switch" aria-checked="${settings[toggle.key]}">
        <span><b>${toggle.label}</b><small>${toggle.description}</small></span>
        <em>${settings[toggle.key] ? 'ON' : 'OFF'}</em>
      </button>`).join('')}</div>
    <div class="setting-choice"><span><b>인터페이스 크기</b><small>HUD와 메뉴 텍스트 크기를 조정합니다.</small></span><div>
      ${(['compact', 'standard', 'large'] as const).map((value) => `<button data-ui-scale="${value}" class="${settings.uiScale === value ? 'selected' : ''}">${value === 'compact' ? '작게' : value === 'large' ? '크게' : '기본'}</button>`).join('')}
    </div></div>
    <div class="setting-choice"><span><b>색상 식별 모드</b><small>위험·아군·상호작용 색 대비를 변경합니다.</small></span><div>
      ${(['standard', 'deuteranopia', 'high-contrast'] as const).map((value) => `<button data-color-vision="${value}" class="${settings.colorVision === value ? 'selected' : ''}">${value === 'standard' ? '기본' : value === 'deuteranopia' ? '적록 보정' : '고대비'}</button>`).join('')}
    </div></div>
    <div class="setting-choice quality-choice"><span><b>그래픽 품질</b><small>자동 모드는 실제 프레임을 측정해 파티클과 HUD 갱신량을 조절합니다. 현재 ${performanceStatus.tier.toUpperCase()}${performanceStatus.fps ? ` · ${performanceStatus.fps} FPS` : ''}</small></span><div>
      ${(['auto', 'high', 'balanced', 'low'] as const).map((value) => `<button data-graphics-quality="${value}" class="${settings.graphicsQuality === value ? 'selected' : ''}">${value === 'auto' ? '자동' : value === 'high' ? '높음' : value === 'balanced' ? '균형' : '낮음'}</button>`).join('')}
    </div></div>
    <div class="settings-actions">
      <button id="replayTutorial">필드 가이드 열기</button>
      <button id="openPrivacy">개인정보·AI 안내</button>
      <button class="primary" id="closeSettings">설정 완료</button>
    </div>`;
  modalContent.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.setting as 'sound' | 'haptics' | 'reducedMotion' | 'analyticsConsent' | 'aiConsent';
      settings = { ...settings, [key]: !settings[key] };
      applySettings();
      if (key === 'aiConsent') void syncAiConsent();
      if (settings.sound) sound.play('ui');
      renderSettings();
    });
  });
  modalContent.querySelectorAll<HTMLButtonElement>('[data-ui-scale]').forEach((button) => {
    button.addEventListener('click', () => {
      settings = { ...settings, uiScale: button.dataset.uiScale as typeof settings.uiScale };
      applySettings();
      renderSettings();
    });
  });
  modalContent.querySelectorAll<HTMLButtonElement>('[data-color-vision]').forEach((button) => {
    button.addEventListener('click', () => {
      settings = { ...settings, colorVision: button.dataset.colorVision as typeof settings.colorVision };
      applySettings();
      renderSettings();
    });
  });
  modalContent.querySelectorAll<HTMLButtonElement>('[data-graphics-quality]').forEach((button) => {
    button.addEventListener('click', () => {
      settings = { ...settings, graphicsQuality: button.dataset.graphicsQuality as typeof settings.graphicsQuality };
      applySettings();
      renderSettings();
    });
  });
  modalContent.querySelector<HTMLButtonElement>('#replayTutorial')?.addEventListener('click', () => renderTutorial(0));
  modalContent.querySelector<HTMLButtonElement>('#openPrivacy')?.addEventListener('click', () => renderPrivacyCenter());
  modalContent.querySelector<HTMLButtonElement>('#closeSettings')?.addEventListener('click', closeModal);
}

function renderPrivacyCenter(): void {
  currentModal = 'privacy';
  pauseForModal();
  modalContent.innerHTML = `
    <span class="eyebrow">TRUST CENTER // RELEASE ${CLIENT_RELEASE.version}</span>
    <h2>개인정보·AI 투명성</h2>
    <p class="subtle">플레이에 필요한 데이터와 선택 분석 데이터를 분리하며, 대화 원문은 분석 이벤트에 포함하지 않습니다.</p>
    <div class="privacy-grid">
      <article><b>필수 게임 데이터</b><p>게스트 식별자, 재화, 쉘터, 오퍼레이터, 편성과 구매 검증 기록을 계정 유지와 부정 지급 방지에 사용합니다.</p></article>
      <article><b>선택 분석 데이터</b><p>동의한 경우 튜토리얼·작전·보급소 진행과 익명화된 오류 종류만 기록합니다. 설정에서 즉시 철회할 수 있습니다.</p></article>
      <article><b>AI 처리 범위</b><p>전술 명령은 기기 입력과 온라인 서버 권위 판정을 함께 사용합니다. 딥 토크는 별도 동의 시 입력 원문과 선택 오퍼레이터의 최근 요약 기억만 서버 중계로 외부 AI에 전송하며, 키는 앱에 포함하지 않습니다.</p></article>
    </div>
    <div class="consent-panel">선택 분석 데이터: <b>${settings.analyticsConsent ? '허용됨' : '사용 안 함'}</b><br />
      외부 AI 딥 토크: <b>${settings.aiConsent ? '허용됨' : '규칙 기반만 사용'}</b><br />
      대화 원문은 분석 로그에 넣지 않으며, 저장된 요약 기억은 오퍼레이터 화면에서 개별 삭제할 수 있습니다. 결제 영수증은 재화 중복 지급 방지를 위해 계정 삭제 후에도 거래 식별자만 분리 보존될 수 있습니다.</div>
    ${!settings.consentReviewed ? `<div class="privacy-actions"><button id="essentialOnly">필수 데이터만 사용</button><button class="primary" id="allowAnalytics">선택 분석 허용</button></div>` : `
      <div class="privacy-actions">
        <button id="toggleAnalytics">선택 분석 ${settings.analyticsConsent ? '끄기' : '켜기'}</button>
        <button id="exportAccount">내 데이터 JSON 내보내기</button>
      </div>
      <div class="account-delete"><input id="deleteConfirmation" autocomplete="off" placeholder="계정을 삭제하려면 DELETE 입력" /><button class="danger" id="deleteAccount" disabled>계정 영구 삭제</button></div>
      <div class="settings-actions"><button class="primary" id="privacyDone">설정으로 돌아가기</button></div>`}
  `;

  const finishConsent = (analyticsConsent: boolean) => {
    settings = { ...settings, analyticsConsent, consentReviewed: true };
    applySettings();
    closeModal();
  };
  modalContent.querySelector<HTMLButtonElement>('#essentialOnly')?.addEventListener('click', () => finishConsent(false));
  modalContent.querySelector<HTMLButtonElement>('#allowAnalytics')?.addEventListener('click', () => finishConsent(true));
  modalContent.querySelector<HTMLButtonElement>('#toggleAnalytics')?.addEventListener('click', () => {
    settings = { ...settings, analyticsConsent: !settings.analyticsConsent, consentReviewed: true };
    applySettings();
    renderPrivacyCenter();
  });
  modalContent.querySelector<HTMLButtonElement>('#exportAccount')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = '내보내는 중...';
    try {
      const accountAvailable = network.accountAvailable;
      const { endpointConfigured } = network.getDiagnostics();
      if (!accountAvailable && endpointConfigured) throw new Error('ACCOUNT_RECONNECT_REQUIRED');
      const payload = accountAvailable
        ? await network.exportAccount()
        : { schemaVersion: 1, exportedAt: new Date().toISOString(), mode: 'local', profile: state.snapshot() };
      downloadJson(`neural-operatives-data-${new Date().toISOString().slice(0, 10)}.json`, payload);
      showToast(accountAvailable ? '서버 계정 데이터 내보내기 완료' : '로컬 모드 데이터 내보내기 완료');
    } catch {
      showToast('데이터를 내보내지 못했습니다. 서버 재연결 후 다시 시도하세요.');
      button.disabled = false;
      button.textContent = '내 데이터 JSON 내보내기';
    }
  });
  const confirmation = modalContent.querySelector<HTMLInputElement>('#deleteConfirmation');
  const deleteButton = modalContent.querySelector<HTMLButtonElement>('#deleteAccount');
  confirmation?.addEventListener('input', () => { if (deleteButton) deleteButton.disabled = confirmation.value !== 'DELETE'; });
  deleteButton?.addEventListener('click', async () => {
    if (confirmation?.value !== 'DELETE') return;
    deleteButton.disabled = true;
    deleteButton.textContent = '삭제 중...';
    try {
      const accountAvailable = network.accountAvailable;
      const { endpointConfigured } = network.getDiagnostics();
      if (accountAvailable) await network.deleteAccount();
      else if (endpointConfigured) throw new Error('ACCOUNT_RECONNECT_REQUIRED');
      clearLocalAccount();
      window.location.reload();
    } catch {
      deleteButton.disabled = false;
      deleteButton.textContent = '계정 영구 삭제';
      showToast('계정을 삭제하지 못했습니다. 서버 재연결 후 다시 시도하세요.');
    }
  });
  modalContent.querySelector<HTMLButtonElement>('#privacyDone')?.addEventListener('click', renderSettings);
}

function renderAlphaInfo(): void {
  currentModal = 'alpha';
  pauseForModal();
  const diagnostics = {
    ...network.getDiagnostics(),
    performance: { qualityMode: settings.graphicsQuality, ...performanceStatus },
    analyticsConsent: settings.analyticsConsent,
    aiConsent: settings.aiConsent,
    commerceEnabled: CLIENT_RELEASE.commerceEnabled,
    generatedAt: new Date().toISOString(),
  };
  const serverVersion = diagnostics.server?.version ?? '연결되지 않음';
  const versionMatch = diagnostics.server ? diagnostics.server.version === CLIENT_RELEASE.version : false;
  modalContent.innerHTML = `
    <span class="eyebrow">PRIVATE ALPHA // BUILD DIAGNOSTICS</span>
    <h2>테스터 작전실</h2>
    <p class="subtle">이 빌드는 정식 결제 없이 전투 안정성·조작성·첫 작전 완료율을 검증합니다.</p>
    <div class="alpha-status-grid">
      <article><span>CLIENT BUILD</span><b>${escapeHtml(CLIENT_RELEASE.version)}</b><small>${escapeHtml(CLIENT_RELEASE.channel.toUpperCase())} CHANNEL</small></article>
      <article><span>GAME SERVER</span><b class="${diagnostics.connected ? 'ok' : 'warn'}">${diagnostics.connected ? 'ONLINE' : 'OFFLINE'}</b><small>SERVER ${escapeHtml(serverVersion)}</small></article>
      <article><span>VERSION SYNC</span><b class="${versionMatch ? 'ok' : 'warn'}">${versionMatch ? 'MATCHED' : 'CHECK'}</b><small>${diagnostics.server?.commit ? escapeHtml(diagnostics.server.commit.slice(0, 12)) : 'NO COMMIT DATA'}</small></article>
      <article><span>ERROR REPORTING</span><b>${settings.analyticsConsent ? 'ENABLED' : 'OPTED OUT'}</b><small>대화 원문·스택 미전송</small></article>
    </div>
    <div class="alpha-notice"><b>알파 테스트 범위</b><p>Operation Zero 완료, 서버 재접속, 모바일 터치·게임패드, 발열과 프레임 저하를 중점 확인합니다. 보급소는 플랫폼 샌드박스가 연결될 때까지 숨겨집니다.</p></div>
    <form class="alpha-feedback-form" id="alphaFeedbackForm">
      <div class="alpha-feedback-heading">
        <div><b>현장 피드백</b><p>한 줄이어도 좋습니다. 지금 플레이를 계속하거나 그만둘 이유를 알려주세요.</p></div>
        <label>평가
          <select id="alphaFeedbackRating" aria-label="게임 경험 평가">
            <option value="5">5 · 매우 좋음</option>
            <option value="4">4 · 좋음</option>
            <option value="3">3 · 보통</option>
            <option value="2">2 · 아쉬움</option>
            <option value="1">1 · 진행 어려움</option>
          </select>
        </label>
      </div>
      <div class="alpha-feedback-fields">
        <label>분류
          <select id="alphaFeedbackCategory">
            <option value="controls">조작</option>
            <option value="performance">성능·발열</option>
            <option value="connection">연결·복구</option>
            <option value="progression">성장·계약</option>
            <option value="ai">오퍼레이터 AI</option>
            <option value="other">기타</option>
          </select>
        </label>
        <label class="alpha-feedback-message">내용
          <textarea id="alphaFeedbackMessage" maxlength="800" minlength="4" placeholder="예: 첫 보스까지는 재미있었지만 모바일 조준이 너무 민감했습니다." required></textarea>
        </label>
      </div>
      <div class="alpha-feedback-submit">
        <small>제출 시 평가·메시지와 아래의 비식별 빌드 진단값이 서버에 저장됩니다. 개인정보·연락처는 입력하지 마세요. 계정 삭제 시 함께 삭제됩니다.</small>
        <button class="primary" type="submit" id="submitAlphaFeedback">서버로 제출</button>
      </div>
      <p class="alpha-feedback-status" id="alphaFeedbackStatus" role="status"></p>
    </form>
    <pre class="diagnostic-preview">${escapeHtml(JSON.stringify(diagnostics, null, 2))}</pre>
    <div class="settings-actions alpha-actions">
      <button id="copyDiagnostics">진단 정보 복사</button>
      <button id="alphaPrivacy">오류 수집 설정</button>
      ${CLIENT_RELEASE.feedbackUrl ? '<button class="primary" id="openFeedback">외부 설문 열기</button>' : ''}
    </div>`;
  modalContent.querySelector<HTMLButtonElement>('#copyDiagnostics')?.addEventListener('click', async () => {
    const text = JSON.stringify(diagnostics, null, 2);
    try {
      if (!navigator.clipboard) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(text);
      showToast('진단 정보가 복사되었습니다.');
    } catch {
      downloadJson(`neo-alpha-diagnostics-${Date.now()}.json`, diagnostics);
      showToast('진단 정보 파일을 저장했습니다.');
    }
  });
  modalContent.querySelector<HTMLButtonElement>('#alphaPrivacy')?.addEventListener('click', renderPrivacyCenter);
  modalContent.querySelector<HTMLFormElement>('#alphaFeedbackForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = modalContent.querySelector<HTMLButtonElement>('#submitAlphaFeedback');
    const status = modalContent.querySelector<HTMLElement>('#alphaFeedbackStatus');
    const message = modalContent.querySelector<HTMLTextAreaElement>('#alphaFeedbackMessage')?.value.trim() ?? '';
    const category = modalContent.querySelector<HTMLSelectElement>('#alphaFeedbackCategory')?.value as
      'controls' | 'performance' | 'connection' | 'progression' | 'ai' | 'other';
    const rating = Number(modalContent.querySelector<HTMLSelectElement>('#alphaFeedbackRating')?.value ?? 0);
    if (message.length < 4) {
      if (status) status.textContent = '내용을 네 글자 이상 입력해주세요.';
      return;
    }
    if (!network.accountAvailable) {
      if (status) status.textContent = '서버 계정 연결 후 제출할 수 있습니다. 진단 정보 복사로 내용을 보관할 수 있습니다.';
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = '제출 중…';
    }
    if (status) status.textContent = '';
    try {
      await network.submitAlphaFeedback({
        category,
        rating,
        message,
        diagnostics: {
          appVersion: diagnostics.appVersion,
          channel: diagnostics.releaseChannel,
          platform: diagnostics.platform,
          connected: diagnostics.connected,
          reconnects: diagnostics.reconnects,
          serverVersion: diagnostics.server?.version ?? 'unavailable',
          qualityMode: diagnostics.performance.qualityMode,
          performanceTier: diagnostics.performance.tier,
          fps: Math.round(diagnostics.performance.fps),
        },
      });
      const textarea = modalContent.querySelector<HTMLTextAreaElement>('#alphaFeedbackMessage');
      if (textarea) textarea.value = '';
      if (status) status.textContent = '제출 완료. 이 피드백은 다음 빌드 우선순위에 반영됩니다.';
      showToast('알파 피드백이 제출되었습니다.');
    } catch {
      if (status) status.textContent = '제출하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.';
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '서버로 제출';
      }
    }
  });
  modalContent.querySelector<HTMLButtonElement>('#openFeedback')?.addEventListener('click', () => {
    if (CLIENT_RELEASE.feedbackUrl) window.open(CLIENT_RELEASE.feedbackUrl, '_blank', 'noopener,noreferrer');
  });
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function clearLocalAccount(): void {
  for (const key of [
    'neo-save-v1', 'neo-settings-v1', 'neo-settings-v2', 'neo-settings-v3', 'neo-settings-v4', 'neo-device-id',
  ]) localStorage.removeItem(key);
}

function renderTutorial(step: number): void {
  const safeStep = Math.max(0, Math.min(tutorialSteps.length - 1, step));
  const tutorial = tutorialSteps[safeStep];
  const continuing = currentModal === 'tutorial' && !modalBackdrop.classList.contains('hidden');
  currentModal = 'tutorial';
  if (!continuing) pauseForModal();
  modalContent.innerHTML = `
    <div class="field-guide">
      <aside class="guide-rail">
        <div class="guide-identity">
          <span>N//E FIELD MANUAL</span>
          <b>OPERATIVE<br />ONBOARDING</b>
          <small>전술 생존부터 장기 성장까지</small>
        </div>
        <nav aria-label="필드 가이드 목차">
          ${tutorialSteps.map((item, index) => `
            <button data-tutorial-step="${index}" class="${index === safeStep ? 'active' : ''}" ${index === safeStep ? 'aria-current="step"' : ''}>
              <span>${String(index + 1).padStart(2, '0')}</span>
              <b>${item.title}</b>
              <small>${item.code.split('//')[1]?.trim() ?? item.code}</small>
            </button>`).join('')}
        </nav>
        <div class="guide-loop">
          <span>CORE GAME LOOP</span>
          <div><b>탐사</b><i>→</i><b>전술</b><i>→</i><b>추출</b><i>→</i><b>성장</b></div>
        </div>
      </aside>
      <section class="guide-stage">
        <div class="guide-progress">
          <span>FIELD GUIDE // ${tutorial.code}</span>
          <b>${String(safeStep + 1).padStart(2, '0')} <i>/ ${String(tutorialSteps.length).padStart(2, '0')}</i></b>
        </div>
        <div class="guide-progress-track"><i style="width:${(safeStep + 1) / tutorialSteps.length * 100}%"></i></div>
        <div class="guide-hero">
          <div class="guide-visual" aria-hidden="true">
            <span>${tutorial.icon}</span>
            <b>${String(safeStep + 1).padStart(2, '0')}</b>
          </div>
          <div>
            <span class="eyebrow">OPERATIVE KNOWLEDGE MODULE</span>
            <h2 tabindex="-1">${tutorial.title}</h2>
            <p>${tutorial.body}</p>
          </div>
        </div>
        <div class="guide-utility">
          <span>이렇게 활용하세요</span>
          <strong>${tutorial.utility}</strong>
        </div>
        <div class="guide-note">
          <span>FIELD NOTE</span>
          <p>${tutorial.tip}</p>
        </div>
        <div class="tutorial-keys">${tutorial.keys.map((key) => `<kbd>${key}</kbd>`).join('')}</div>
        <div class="tutorial-actions">
          <button id="closeGuide">가이드 닫기</button>
          <button id="previousTutorial" ${safeStep === 0 ? 'disabled' : ''}>이전</button>
          <button class="primary" id="nextTutorial">${safeStep === tutorialSteps.length - 1 ? (settings.tutorialComplete ? '작전으로 돌아가기' : '작전 투입') : '다음 모듈'}</button>
        </div>
      </section>
    </div>`;
  modalContent.querySelectorAll<HTMLButtonElement>('[data-tutorial-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = Number(button.dataset.tutorialStep);
      if (Number.isInteger(target)) {
        sound.play('ui');
        renderTutorial(target);
      }
    });
  });
  modalContent.querySelector<HTMLButtonElement>('#closeGuide')?.addEventListener('click', closeModal);
  modalContent.querySelector<HTMLButtonElement>('#previousTutorial')?.addEventListener('click', () => {
    if (safeStep > 0) {
      sound.play('ui');
      renderTutorial(safeStep - 1);
    }
  });
  modalContent.querySelector<HTMLButtonElement>('#nextTutorial')?.addEventListener('click', () => {
    sound.play('ui');
    if (safeStep < tutorialSteps.length - 1) {
      renderTutorial(safeStep + 1);
      return;
    }
    settings = { ...settings, tutorialComplete: true };
    applySettings();
    void network.track('tutorial_complete', { steps: tutorialSteps.length });
    closeModal();
  });
  window.requestAnimationFrame(() => {
    modalContent.querySelector<HTMLElement>('[aria-current="step"]')?.scrollIntoView({
      block: 'nearest', inline: 'center', behavior: settings.reducedMotion ? 'auto' : 'smooth',
    });
    if (continuing) modalContent.querySelector<HTMLHeadingElement>('.guide-stage h2')?.focus({ preventScroll: true });
  });
}

async function renderContracts(): Promise<void> {
  currentModal = 'contracts';
  pauseForModal();
  modalContent.innerHTML = `
    <div class="contract-loading">
      <span class="eyebrow">SHELTER DISPATCH // SECURE CONTRACT FEED</span>
      <h2>생존 계약 동기화 중</h2>
      <p class="subtle">현재 작전 기록과 수령 가능한 보상을 확인하고 있습니다.</p>
    </div>`;

  let board: ContractBoard;
  let authoritative = false;
  try {
    if (!network.accountAvailable) throw new Error('ACCOUNT_API_OFFLINE');
    board = await network.getContractBoard();
    authoritative = true;
  } catch {
    board = state.contractBoard();
    showToast('계약 서버에 연결하지 못해 로컬 보드를 표시합니다.');
  }
  if (currentModal !== 'contracts') return;
  latestContractBoard = board;
  renderContractBoard(board, authoritative);
  void network.track('contract_view', {
    daily: board.daily.length,
    weekly: board.weekly.length,
    streak: board.streak,
    online: authoritative,
  });
}

function renderContractBoard(board: ContractBoard, authoritative = network.accountAvailable): void {
  const claimable = [...board.daily, ...board.weekly].filter((contract) => contract.completed && !contract.claimed).length;
  const dailyReset = new Date(board.nextDailyResetAt).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const weeklyReset = new Date(board.nextWeeklyResetAt).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const cards = (contracts: ContractCard[]) => contracts.map((contract) => {
    const progress = Math.min(100, Math.round((contract.progress / contract.target) * 100));
    return `<article class="contract-card ${contract.claimed ? 'claimed' : contract.completed ? 'complete' : ''}">
      <div class="contract-card-head"><span>${contract.cadence === 'daily' ? 'DAILY' : 'WEEKLY'} // ${contract.id.toUpperCase()}</span>
      <em>${contract.claimed ? 'CLAIMED' : contract.completed ? 'READY' : `${contract.progress} / ${contract.target}`}</em></div>
      <h3>${escapeHtml(contract.title)}</h3>
      <p>${escapeHtml(contract.description)}</p>
      <div class="contract-progress"><i style="width:${progress}%"></i></div>
      <div class="contract-reward"><span>REWARD</span><b>${formatContractReward(contract.reward)}</b></div>
      <button data-contract-claim="${contract.id}" ${contract.completed && !contract.claimed ? '' : 'disabled'}>
        ${contract.claimed ? '수령 완료' : contract.completed ? '보상 수령' : '진행 중'}
      </button>
    </article>`;
  }).join('');

  modalContent.innerHTML = `
    <span class="eyebrow">SHELTER DISPATCH // ${authoritative ? 'SERVER VERIFIED' : 'LOCAL TRAINING'}</span>
    <div class="contract-heading">
      <div><h2>생존 계약 보드</h2><p>${authoritative
    ? '플레이 기록을 서버가 검증한 뒤 보상을 확정합니다.'
    : '서버 연결 전에는 훈련용 진행도를 표시하며 온라인 계정에는 합산되지 않습니다.'}</p></div>
      <div class="streak-core"><span>ACTIVE STREAK</span><b>${board.streak}</b><small>3일마다 데이터 · 7일마다 코어 보너스</small></div>
    </div>
    ${claimable ? `<div class="contract-ready-banner">수령 가능한 계약 ${claimable}개 // 보상 신호가 대기 중입니다.</div>` : ''}
    <section class="contract-section">
      <header><div><span>DAILY ROTATION</span><h3>오늘의 계약</h3></div><small>${dailyReset} 갱신 · KST</small></header>
      <div class="contract-grid">${cards(board.daily)}</div>
    </section>
    <section class="contract-section weekly">
      <header><div><span>WEEKLY DIRECTIVE</span><h3>주간 지령</h3></div><small>${weeklyReset} 갱신 · KST</small></header>
      <div class="contract-grid weekly">${cards(board.weekly)}</div>
    </section>
    <p class="contract-fairness">${authoritative
    ? '계약 보상은 구매와 무관하며 모든 플레이어에게 동일한 주기로 제공됩니다. 미수령 보상은 다음 갱신 시 사라집니다.'
    : 'LOCAL TRAINING // 이 보드의 진행도와 보상은 기기에만 저장됩니다. 서버 연결 후 권위형 계약 보드로 교체됩니다.'}</p>`;

  modalContent.querySelectorAll<HTMLButtonElement>('[data-contract-claim]').forEach((button) => {
    button.addEventListener('click', async () => {
      const contractId = button.dataset.contractClaim as ContractId;
      button.disabled = true;
      button.textContent = '확정 중…';
      try {
        const usedServer = authoritative;
        const result = usedServer
          ? await network.claimContract(contractId)
          : state.claimContract(contractId);
        if (!result) throw new Error('CONTRACT_CLAIM_REJECTED');
        latestContractBoard = result.board;
        renderPersistentHud();
        renderContractBoard(result.board, usedServer);
        const bonusText = result.streakBonus ? ` · 연속 보너스 ${formatContractReward(result.streakBonus)}` : '';
        showToast(`계약 보상 ${formatContractReward(result.reward)}${bonusText}`);
        void network.track('contract_claim', {
          contractId,
          cadence: [...result.board.daily, ...result.board.weekly]
            .find((contract) => contract.id === contractId)?.cadence ?? 'unknown',
          streak: result.board.streak,
          online: usedServer,
        });
      } catch {
        showToast('계약 보상을 확정하지 못했습니다. 진행도와 연결 상태를 확인하세요.');
        if (latestContractBoard) renderContractBoard(latestContractBoard, authoritative);
      }
    });
  });
}

function formatContractReward(reward: ContractReward): string {
  const entries = (Object.keys(reward) as Array<keyof ContractReward>)
    .filter((key) => reward[key] > 0)
    .map((key) => `${icons[key]} ${reward[key]}`);
  return entries.join(' + ') || '보상 없음';
}

function renderShelter(): void {
  currentModal = 'shelter';
  pauseForModal();
  const save = state.snapshot();
  const modules: Array<{ key: keyof ShelterModules; name: string; description: string }> = [
    { key: 'command', name: '지휘 통제실', description: '탐사 데이터 분석 효율과 오프라인 데이터 획득량을 높입니다.' },
    { key: 'purifier', name: '식수 정화 시스템', description: '안전 구역의 자동 식수 생산 효율을 높입니다.' },
    { key: 'workshop', name: '정크 워크숍', description: '오퍼레이터의 오프라인 고철 회수 효율을 높입니다.' },
    { key: 'greenhouse', name: '지하 온실', description: '장기 생존 기반 시설. 후속 버전에서 회복 버프를 제공합니다.' },
  ];
  const gearBonuses = describeGearBonuses(save.gear.equipped);
  modalContent.innerHTML = `
    <span class="eyebrow">UNDERGROUND SHELTER // SECTOR 7</span>
    <h2>쉘터 재건</h2>
    <p class="subtle">오프라인 최대 8시간 동안 오퍼레이터가 안전 구역의 자원을 회수합니다.</p>
    <div class="card-grid">${modules.map((module) => {
      const level = save.shelter[module.key];
      const scrapCost = 80 + level * 90;
      const dataCost = 12 + level * 9;
      const disabled = level >= 5 || save.resources.scrap < scrapCost || save.resources.data < dataCost;
      return `<article class="data-card">
        <span class="level">LV.${level} / 5</span><h3>${module.name}</h3><p>${module.description}</p>
        <button data-upgrade="${module.key}" ${disabled ? 'disabled' : ''}>${level >= 5 ? 'MAXIMUM' : `UPGRADE // ▰ ${scrapCost} + ◇ ${dataCost}`}</button>
      </article>`;
    }).join('')}</div>
    <div class="recruit-panel"><div><b>방치 생산 예상치</b><div class="subtle">시간당 고철 ${Math.round(13.2 * (1 + (save.shelter.workshop - 1) * .35))} · 식수 ${Math.round(8.4 * (1 + (save.shelter.purifier - 1) * .3))}</div></div></div>
    <section class="fabrication-panel">
      <div class="fabrication-heading">
        <div><span class="eyebrow">JUNK WORKSHOP // TACTICAL FABRICATION</span><h3>전술 장비 제작</h3></div>
        <div><b>${save.gear.equipped.length} / ${MAX_EQUIPPED_GEAR} 장착</b><small>${gearBonuses.join(' · ') || '활성 장비 효과 없음'}</small></div>
      </div>
      <p class="subtle">추출 자원을 영구 장비로 전환합니다. 효과는 로컬 훈련과 온라인 서버 전투에 동일하게 적용됩니다.</p>
      <div class="gear-grid">${GEAR_IDS.map((gearId) => {
        const gear = GEAR_DEFINITIONS[gearId];
        const owned = save.gear.owned.includes(gearId);
        const equipped = save.gear.equipped.includes(gearId);
        const workshopLocked = save.shelter.workshop < gear.requiredWorkshop;
        const affordable = (Object.keys(gear.cost) as Array<keyof typeof gear.cost>)
          .every((key) => save.resources[key] >= gear.cost[key]);
        const cost = (Object.keys(gear.cost) as Array<keyof typeof gear.cost>)
          .filter((key) => gear.cost[key] > 0)
          .map((key) => `${icons[key]} ${gear.cost[key]}`).join(' + ');
        return `<article class="gear-card ${equipped ? 'equipped' : ''}">
          <div class="gear-mark">${gear.mark}</div><span>${gear.category} // WORKSHOP LV.${gear.requiredWorkshop}</span>
          <h4>${gear.name}</h4><p>${gear.description}</p><strong>${gear.effectLabel}</strong>
          ${owned
            ? `<button data-toggle-gear="${gearId}" class="${equipped ? 'remove' : ''}">${equipped ? '장착 해제' : 'LOADOUT 장착'}</button>`
            : `<button data-craft-gear="${gearId}" ${workshopLocked || !affordable ? 'disabled' : ''}>${workshopLocked ? `워크숍 LV.${gear.requiredWorkshop} 필요` : `제작 // ${cost}`}</button>`}
        </article>`;
      }).join('')}</div>
    </section>`;
  modalContent.querySelectorAll<HTMLButtonElement>('[data-upgrade]').forEach((button) => {
    button.addEventListener('click', async () => {
      const module = button.dataset.upgrade as keyof ShelterModules;
      try {
        const upgraded = network.connected ? Boolean(await network.upgradeShelter(module)) : state.upgrade(module);
        if (!upgraded) return;
        renderPersistentHud();
        renderShelter();
        showToast('쉘터 모듈 업그레이드 완료');
      } catch {
        showToast('서버가 업그레이드를 거부했습니다. 재화와 연결 상태를 확인하세요.');
      }
    });
  });
  modalContent.querySelectorAll<HTMLButtonElement>('[data-craft-gear]').forEach((button) => {
    button.addEventListener('click', async () => {
      const gearId = button.dataset.craftGear as GearId;
      const hadOpenSlot = state.snapshot().gear.equipped.length < MAX_EQUIPPED_GEAR;
      try {
        const crafted = network.connected ? Boolean(await network.craftGear(gearId)) : state.craftGear(gearId);
        if (!crafted) throw new Error('CRAFT_REJECTED');
        if (!network.connected) gameEvents.emit('loadout-changed');
        renderPersistentHud();
        renderShelter();
        showToast(`${GEAR_DEFINITIONS[gearId].name} 제작 완료${hadOpenSlot ? ' // 빈 슬롯에 자동 장착' : ' // 장비고에 보관'}`);
      } catch {
        showToast('장비 제작에 실패했습니다. 워크숍 레벨과 재화를 확인하세요.');
      }
    });
  });
  modalContent.querySelectorAll<HTMLButtonElement>('[data-toggle-gear]').forEach((button) => {
    button.addEventListener('click', async () => {
      const gearId = button.dataset.toggleGear as GearId;
      const current = state.snapshot().gear.equipped;
      const equipped = current.includes(gearId);
      if (!equipped && current.length >= MAX_EQUIPPED_GEAR) {
        showToast(`장비 슬롯은 ${MAX_EQUIPPED_GEAR}개입니다. 기존 장비를 먼저 해제하세요.`);
        return;
      }
      const next = equipped ? current.filter((id) => id !== gearId) : [...current, gearId];
      try {
        if (network.connected) await network.setGearLoadout(next);
        else if (!state.setGearLoadout(next)) throw new Error('LOADOUT_REJECTED');
        if (!network.connected) gameEvents.emit('loadout-changed');
        renderPersistentHud();
        renderShelter();
        showToast(`${GEAR_DEFINITIONS[gearId].name} ${equipped ? '장착 해제' : '전투 적용'}`);
      } catch {
        showToast('장비 구성을 저장하지 못했습니다. 연결 상태를 확인하세요.');
      }
    });
  });
}

function renderRoster(): void {
  const wasOpen = currentModal === 'roster';
  currentModal = 'roster';
  pauseForModal();
  const save = state.snapshot();
  if (!wasOpen) squadDraft = [...save.squad];
  if (!rosterSelection || !save.operators.some((operator) => operator.id === rosterSelection)) {
    rosterSelection = save.operators[0]?.id ?? null;
  }
  const selectedOwned = save.operators.find((operator) => operator.id === rosterSelection);
  if (!selectedOwned) return;
  const selected = getOperator(selectedOwned.id);
  const selectedInSquad = squadDraft.includes(selected.id);
  const squadChanged = squadDraft.join('|') !== save.squad.join('|');
  const bonusDescriptions = describeSquadBonuses(squadDraft);
  modalContent.innerHTML = `
    <span class="eyebrow">NEURAL CORE ARCHIVE // OWNED ${save.operators.length}</span>
    <h2>오퍼레이터 링크</h2>
    <p class="subtle">보유 오퍼레이터를 확인하고 레드 존에 투입할 3명을 편성합니다. 편성 보너스는 온라인 전투에서도 서버가 직접 판정합니다.</p>
    <div class="roster-layout">
      <section class="operator-showcase" data-rarity="${selected.rarity}">
        <div class="showcase-visual">
          <img src="${selected.portrait}" alt="${selected.name} 전신 일러스트" loading="eager" />
          <div class="showcase-caption"><span>${selected.rarity} // ${selected.role}</span><strong>${selected.callsign}</strong><small>${selected.name}</small></div>
        </div>
        <div class="operator-dossier">
          <div class="operator-tags"><span>CORE LV.${selectedOwned.level}</span><span>NEURAL LINK ${selectedOwned.bond}%</span></div>
          <p>${escapeHtml(selected.background)}</p>
          <blockquote>“${escapeHtml(selected.combatLine)}”</blockquote>
          <div class="combat-metrics">${roleMetrics[selected.role].map((metric) => `
            <div><span>${metric.label}</span><i><b style="width:${metric.value}%"></b></i><em>${metric.value}</em></div>`).join('')}</div>
          <div class="bond-meter"><span>RELATIONSHIP SYNC</span><i><b style="width:${selectedOwned.bond}%"></b></i></div>
          <div class="memory-log"><b>최근 장기 기억</b><span>${escapeHtml(selectedOwned.memories[0] ?? '아직 형성된 장기 기억이 없습니다.')}</span></div>
          <button class="deep-talk-button" data-deep-talk="${selected.id}">DEEP TALK // 대화 링크</button>
          <button class="squad-toggle ${selectedInSquad ? 'assigned' : ''}" data-toggle-squad="${selected.id}">${selectedInSquad ? '분대에서 해제' : '분대에 배치'}</button>
        </div>
      </section>
      <aside class="roster-control">
        <div class="formation-heading"><div><span class="eyebrow">ACTIVE FORMATION</span><b>레드 존 3인 분대</b></div><small>${squadDraft.length} / 3 LINKED</small></div>
        <div class="formation-slots">${[0, 1, 2].map((slot) => {
          const operatorId = squadDraft[slot];
          if (!operatorId) return `<div class="formation-slot empty"><span>0${slot + 1}</span><b>EMPTY LINK</b></div>`;
          const operator = getOperator(operatorId);
          return `<button class="formation-slot" data-operator-id="${operator.id}"><span>0${slot + 1}</span><img src="${operator.portrait}" alt="" /><b>${operator.callsign}</b><small>${operator.role}</small></button>`;
        }).join('')}</div>
        <div class="bonus-panel"><span>SERVER COMBAT BONUS</span><div>${bonusDescriptions.length
          ? bonusDescriptions.map((bonus) => `<b>${bonus}</b>`).join('')
          : '<small>오퍼레이터를 배치하면 전투 보너스가 활성화됩니다.</small>'}</div></div>
        <button class="primary formation-save" id="saveSquad" ${squadDraft.length !== 3 || !squadChanged ? 'disabled' : ''}>분대 편성 확정</button>
        <div class="operator-tile-grid">${save.operators.map((owned) => {
          const operator = getOperator(owned.id);
          const squadIndex = squadDraft.indexOf(operator.id);
          return `<button class="operator-tile ${operator.id === selected.id ? 'selected' : ''}" data-operator-id="${operator.id}" data-rarity="${operator.rarity}">
            <img src="${operator.portrait}" alt="${operator.name}" loading="lazy" />
            <span><b>${operator.name}</b><small>${operator.callsign}</small></span>
            ${squadIndex >= 0 ? `<em>0${squadIndex + 1}</em>` : ''}
          </button>`;
        }).join('')}</div>
      </aside>
    </div>
    <div class="recruit-panel">
      <div><b>신경망 코어 복원</b><div class="subtle">코어 5개 사용 · SSR 천장까지 ${20 - save.pity}회 · 중복은 레벨과 데이터로 전환</div></div>
      <button class="primary" id="recruitButton" ${save.resources.cores < 5 ? 'disabled' : ''}>◈ 5 // LINK</button>
    </div>`;
  modalContent.querySelectorAll<HTMLButtonElement>('[data-operator-id]').forEach((button) => {
    button.addEventListener('click', () => {
      rosterSelection = button.dataset.operatorId ?? rosterSelection;
      renderRoster();
    });
  });
  modalContent.querySelector<HTMLButtonElement>('[data-deep-talk]')?.addEventListener('click', (event) => {
    const operatorId = (event.currentTarget as HTMLButtonElement).dataset.deepTalk;
    if (operatorId) renderDeepTalk(operatorId);
  });
  modalContent.querySelector<HTMLButtonElement>('[data-toggle-squad]')?.addEventListener('click', (event) => {
    const operatorId = (event.currentTarget as HTMLButtonElement).dataset.toggleSquad;
    if (!operatorId) return;
    if (squadDraft.includes(operatorId)) {
      squadDraft = squadDraft.filter((id) => id !== operatorId);
    } else if (squadDraft.length < 3) {
      squadDraft = [...squadDraft, operatorId];
    } else {
      showToast('분대는 최대 3명입니다. 기존 오퍼레이터를 먼저 해제하세요.');
      return;
    }
    renderRoster();
  });
  modalContent.querySelector<HTMLButtonElement>('#saveSquad')?.addEventListener('click', async () => {
    try {
      if (network.connected) {
        const profile = await network.setSquad([...squadDraft]);
        squadDraft = [...profile.squad];
      } else if (!state.setSquad([...squadDraft])) {
        throw new Error('INVALID_LOCAL_SQUAD');
      } else {
        gameEvents.emit('squad-changed');
      }
      renderPersistentHud();
      renderRoster();
      showToast('3인 분대 편성이 확정되었습니다.');
    } catch {
      showToast('분대 편성을 저장하지 못했습니다. 보유 오퍼레이터와 연결 상태를 확인하세요.');
    }
  });
  modalContent.querySelector<HTMLButtonElement>('#recruitButton')?.addEventListener('click', async () => {
    try {
      const result = network.connected ? (await network.recruit()).result : state.recruit();
      if (!result) return;
      const operator = getOperator(result.operatorId);
      renderPersistentHud();
      renderRoster();
      showToast(`${result.rarity} ${operator.name} ${result.duplicate ? '동기화 강화' : '신규 링크 완료'}`);
    } catch {
      showToast('서버가 모집 요청을 거부했습니다. 코어와 연결 상태를 확인하세요.');
    }
  });
}

function renderDeepTalk(operatorId: string): void {
  currentModal = 'deep-talk';
  pauseForModal();
  rosterSelection = operatorId;
  const operator = getOperator(operatorId);
  const owned = state.snapshot().operators.find((candidate) => candidate.id === operatorId);
  if (!owned) {
    renderRoster();
    return;
  }
  const diagnostics = network.getDiagnostics();
  const externalAvailable = Boolean(diagnostics.server?.aiAvailable);
  const remoteReady = Boolean(network.connected && settings.aiConsent && externalAvailable);
  const history = talkHistory.get(operatorId) ?? [];
  const usage = talkUsage.get(operatorId);
  const memoryLimit = operatorMemoryLimit(operator.rarity);
  const transcript = history.length
    ? history.map((line) => `<div class="talk-line ${line.role}">
        <span>${line.role === 'player' ? 'SURVIVOR' : operator.callsign}${line.source ? ` // ${line.source.toUpperCase()}` : ''}</span>
        <p>${escapeHtml(line.text)}</p>
      </div>`).join('')
    : `<div class="talk-line operator"><span>${operator.callsign} // LINK READY</span><p>${escapeHtml(operator.combatLine)}</p></div>`;
  const memoryItems = owned.memories.length
    ? owned.memories.map((memory) => `<li>${escapeHtml(memory)}</li>`).join('')
    : '<li class="empty">아직 형성된 장기 기억이 없습니다.</li>';

  modalContent.innerHTML = `
    <span class="eyebrow">PERSONA LINK // PRIVATE SHELTER CHANNEL</span>
    <div class="deep-talk-layout" style="--operator-color:#${operator.color.toString(16).padStart(6, '0')}">
      <aside class="deep-talk-portrait">
        <img src="${operator.portrait}" alt="${operator.name} 전신 일러스트" />
        <div><span>${operator.rarity} // ${operator.role}</span><strong>${operator.callsign}</strong><small>${operator.name}</small></div>
      </aside>
      <section class="deep-talk-console">
        <header>
          <div><h2>딥 토크</h2><p>${escapeHtml(operator.speechStyle)}</p></div>
          <span class="ai-link-state ${remoteReady ? 'online' : ''}">${remoteReady ? '● EXTERNAL AI LINK' : '○ LOCAL PERSONA CORE'}</span>
        </header>
        <div class="talk-transcript" aria-live="polite">${transcript}</div>
        ${externalAvailable && !settings.aiConsent ? `<div class="ai-consent-callout">
          <p>외부 AI 대화는 선택 사항입니다. 켜면 입력 원문과 최근 요약 기억만 응답 생성 중 서버 중계로 전송됩니다.</p>
          <button id="enableAiTalk">동의하고 AI 링크 사용</button>
        </div>` : ''}
        <form class="deep-talk-form" id="deepTalkForm">
          <label for="deepTalkInput">SHELTER:// ${operator.callsign}</label>
          <div><input id="deepTalkInput" maxlength="280" autocomplete="off" placeholder="${operator.name}에게 이야기하기" />
          <button class="primary" type="submit">전송</button></div>
          <small>${remoteReady
            ? `일일 AI 링크 ${usage?.used ?? latestProfile?.ai.dailyTurnsUsed ?? 0} / ${usage?.limit ?? diagnostics.server?.aiDailyTurnLimit ?? 12}`
            : '규칙 기반 코어는 네트워크나 API 키 없이도 동작합니다.'}</small>
        </form>
        <div class="persona-memory-bank">
          <div><span>LONG-TERM MEMORY</span><b>${owned.memories.length} / ${memoryLimit}</b></div>
          <ul>${memoryItems}</ul>
          <div class="memory-actions"><button id="backToRoster">오퍼레이터로 돌아가기</button>
          <button class="danger" id="clearPersonaMemory" ${owned.memories.length ? '' : 'disabled'}>기억 삭제</button></div>
        </div>
      </section>
    </div>`;

  modalContent.querySelector<HTMLButtonElement>('#enableAiTalk')?.addEventListener('click', async () => {
    settings = { ...settings, aiConsent: true };
    applySettings();
    await syncAiConsent();
    renderDeepTalk(operatorId);
  });
  modalContent.querySelector<HTMLButtonElement>('#backToRoster')?.addEventListener('click', renderRoster);
  modalContent.querySelector<HTMLButtonElement>('#clearPersonaMemory')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      if (network.connected) await network.clearPersonaMemories(operatorId);
      else state.clearMemories(operatorId);
      talkHistory.delete(operatorId);
      renderDeepTalk(operatorId);
      showToast(`${operator.name}의 저장 기억을 삭제했습니다.`);
    } catch {
      button.disabled = false;
      showToast('기억을 삭제하지 못했습니다. 연결 상태를 확인하세요.');
    }
  });
  modalContent.querySelector<HTMLFormElement>('#deepTalkForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = modalContent.querySelector<HTMLInputElement>('#deepTalkInput');
    const message = input?.value.trim() ?? '';
    if (!message) return;
    const lines = talkHistory.get(operatorId) ?? [];
    lines.push({ role: 'player', text: message });
    talkHistory.set(operatorId, lines.slice(-12));
    renderDeepTalk(operatorId);

    let reply: string;
    let source: 'ai' | 'rules' = 'rules';
    try {
      if (network.connected) {
        if (settings.aiConsent) await syncAiConsent();
        const result = await network.personaChat(operatorId, message, settings.aiConsent);
        reply = result.exchange.reply;
        source = result.exchange.source;
        talkUsage.set(operatorId, result.usage);
      } else {
        reply = createDeepTalkFallback(operator, message, Date.now());
        state.remember(operatorId, `${operator.name}와 “${message.slice(0, 72)}”에 관해 쉘터에서 대화했다.`);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'SERVER_422') {
        reply = '이 신호에는 안전상 응답할 수 없습니다. 다른 이야기로 링크를 다시 맞춰 주세요.';
        showToast('안전 필터가 대화를 차단했습니다. 이 입력은 기억에 저장하지 않았습니다.');
      } else {
        reply = createDeepTalkFallback(operator, message, Date.now());
        state.remember(operatorId, `${operator.name}와 “${message.slice(0, 72)}”에 관해 쉘터에서 대화했다.`);
        showToast(code === 'SERVER_429'
          ? '대화 요청이 많아 로컬 코어로 응답했습니다.'
          : '서버 링크가 불안정해 로컬 코어로 응답했습니다.');
      }
    }
    const next = talkHistory.get(operatorId) ?? [];
    next.push({ role: 'operator', text: reply, source });
    talkHistory.set(operatorId, next.slice(-12));
    if (currentModal === 'deep-talk' && rosterSelection === operatorId) renderDeepTalk(operatorId);
  });
}

async function renderStore(): Promise<void> {
  if (!CLIENT_RELEASE.commerceEnabled) {
    renderAlphaInfo();
    showToast('비공개 알파에서는 결제가 비활성화되어 있습니다.');
    return;
  }
  const wasOpen = currentModal === 'store';
  currentModal = 'store';
  pauseForModal();
  modalContent.innerHTML = `
    <div class="store-loading">
      <span class="eyebrow">SHELTER QUARTERMASTER // SECURE UPLINK</span>
      <h2>보급소 연결 중</h2><i></i>
    </div>`;
  if (!wasOpen) void network.track('store_view', { source: 'command_dock' });

  const catalog = await network.getStoreCatalog();
  const platformListings = window.NeoBilling
    ? await window.NeoBilling.getProducts().catch(() => [])
    : [];
  if (currentModal !== 'store') return;
  const products = catalog?.products ?? [...STORE_PRODUCTS];
  const odds = catalog?.recruitOdds ?? RECRUIT_ODDS;
  const billingReady = Boolean(network.connected && catalog?.checkoutAvailable && window.NeoBilling && platformListings.length);
  const founderOwned = latestProfile?.commerce.entitlements.includes('founder_badge') ?? false;
  const subscriptionUntil = latestProfile?.commerce.subscriptionUntil;
  const subscriptionActive = subscriptionUntil ? new Date(subscriptionUntil).getTime() > Date.now() : false;

  modalContent.innerHTML = `
    <span class="eyebrow">SHELTER QUARTERMASTER // VERIFIED SUPPLY</span>
    <div class="store-heading">
      <div><h2>레드 존 보급소</h2><p class="subtle">결제 성공을 플랫폼과 서버가 모두 확인한 뒤에만 계정으로 지급됩니다.</p></div>
      <div class="store-status"><span class="checkout-state ${billingReady ? 'ready' : ''}">${billingReady ? '● CHECKOUT READY' : '○ PREVIEW MODE'}</span>
        <button id="restorePurchases" ${billingReady ? '' : 'disabled'}>구매 복원</button></div>
    </div>
    <div class="store-grid">${products.map((product) => {
      const listing = platformListings.find((item) => item.productId === product.id);
      const owned = product.id === 'founder_supply' && founderOwned;
      const active = product.id === 'neural_sync_30d' && subscriptionActive;
      const disabled = !billingReady || !listing || owned;
      return `<article class="store-card ${product.badge ? 'featured' : ''}">
        <div class="store-card-top"><span>${product.badge ?? product.type.replace('_', ' ').toUpperCase()}</span><b>${escapeHtml(product.title)}</b></div>
        <div class="store-product-mark">${product.id === 'core_cache_s' ? '◈' : product.id === 'founder_supply' ? 'N//E' : '∞'}</div>
        <p>${escapeHtml(product.description)}</p>
        ${active ? `<small class="active-plan">ACTIVE // ${new Date(subscriptionUntil!).toLocaleDateString('ko-KR')}까지</small>` : ''}
        <div class="store-purchase"><strong>${escapeHtml(listing?.localizedPrice ?? `₩${product.displayPriceKrw.toLocaleString('ko-KR')}`)}</strong>
          <button class="primary" data-purchase="${product.id}" ${disabled ? 'disabled' : ''}>${owned ? '보유 중' : billingReady ? '구매' : '결제 준비 중'}</button>
        </div>
      </article>`;
    }).join('')}</div>
    <section class="odds-disclosure">
      <div><span class="eyebrow">NEURAL CORE RESTORE // DISCLOSED ODDS</span><b>오퍼레이터 모집 확률</b></div>
      <dl><div><dt>SSR</dt><dd>${Math.round(odds.SSR * 100)}%</dd></div><div><dt>SR</dt><dd>${Math.round(odds.SR * 100)}%</dd></div><div><dt>R</dt><dd>${Math.round(odds.R * 100)}%</dd></div><div><dt>SSR 확정</dt><dd>${odds.pityAt}회 이내</dd></div></dl>
    </section>
    <p class="store-notice">${escapeHtml(catalog?.priceNotice ?? '표시 가격은 한국 원화 기준 예시이며, 최종 가격과 결제 통화는 플랫폼 결제창의 값이 우선합니다.')}<br />현재 빌드는 결제 어댑터가 연결되기 전까지 미리보기만 제공하며, 결제나 재화 지급을 시도하지 않습니다.</p>`;

  modalContent.querySelector<HTMLButtonElement>('#restorePurchases')?.addEventListener('click', async (event) => {
    if (!billingReady || !window.NeoBilling) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = '복원 중...';
    try {
      const purchases = await window.NeoBilling.restorePurchases();
      for (const purchase of purchases) {
        await network.verifyPurchase(purchase.platform, purchase.productId, purchase.receipt);
      }
      showToast(`구매 복원 완료 // ${purchases.length}건 확인`);
    } catch {
      button.disabled = false;
      button.textContent = '구매 복원';
      showToast('구매 내역을 복원하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
  });

  modalContent.querySelectorAll<HTMLButtonElement>('[data-purchase]').forEach((button) => {
    button.addEventListener('click', async () => {
      const productId = button.dataset.purchase as StoreProductId;
      if (!billingReady || !window.NeoBilling) return;
      button.disabled = true;
      button.textContent = '확인 중...';
      void network.track('checkout_intent', { productId });
      try {
        const purchase = await window.NeoBilling.purchase(productId);
        await network.verifyPurchase(purchase.platform, productId, purchase.receipt);
        showToast('구매 검증 완료 // 보급품이 계정에 지급되었습니다.');
      } catch {
        button.disabled = false;
        button.textContent = '구매';
        showToast('결제가 완료되지 않았습니다. 재화는 지급되지 않았습니다.');
      }
    });
  });
}

function renderGameOver(cargo: Record<string, number>): void {
  currentModal = 'game-over';
  pauseForModal();
  modalContent.innerHTML = `
    <span class="eyebrow">LINK LOST // RECOVERY AVAILABLE</span>
    <h2>작전 실패</h2>
    <p class="subtle">오퍼레이터가 생체 신호를 회수했지만 현장 화물은 소실되었습니다.</p>
    <div class="recruit-panel"><div><b>소실 화물</b><div class="subtle">고철 ${cargo.scrap ?? 0} · 식수 ${cargo.water ?? 0} · 데이터 ${cargo.data ?? 0}</div></div>
    <button class="primary" id="retryButton">다시 투입</button></div>`;
  modalContent.querySelector<HTMLButtonElement>('#retryButton')?.addEventListener('click', closeModal);
}

function renderOperationDebrief(result: {
  operationId: OperationId; codename: string; title: string; narrative: string;
  kills: number; collected: number; weapon: string; online: boolean; bonusCores: number; bonusData: number;
  nextOperationId: OperationId;
}): void {
  currentModal = 'operation-complete';
  pauseForModal();
  modalContent.innerHTML = `
    <section class="debrief">
      <span class="eyebrow">OPERATION ${escapeHtml(result.codename)} // MISSION COMPLETE</span>
      <div class="debrief-mark">S</div>
      <h2>${escapeHtml(result.title)}</h2>
      <p>${escapeHtml(result.narrative)}</p>
      <div class="debrief-stats">
        <div><span>제거</span><b>${result.kills}</b></div>
        <div><span>회수</span><b>${result.collected}</b></div>
        <div><span>주력 무장</span><b>${escapeHtml(result.weapon)}</b></div>
        <div><span>판정</span><b>${result.online ? 'SERVER' : 'LOCAL'}</b></div>
      </div>
      <div class="debrief-reward"><span>작전 보너스</span><b>${result.online ? '보스 전리품 서버 확정' : `뉴럴 코어 +${result.bonusCores} · 데이터 +${result.bonusData}`}</b></div>
      <div class="modal-actions">
        <button class="secondary" id="finishOperation">쉘터로 귀환</button>
        ${result.nextOperationId !== result.operationId ? '<button class="primary" id="nextOperation">다음 작전 즉시 투입</button>' : ''}
      </div>
    </section>`;
  modalContent.querySelector<HTMLButtonElement>('#finishOperation')?.addEventListener('click', () => {
    closeModal();
    renderShelter();
  });
  modalContent.querySelector<HTMLButtonElement>('#nextOperation')?.addEventListener('click', async () => {
    const button = modalContent.querySelector<HTMLButtonElement>('#nextOperation');
    if (button) {
      button.disabled = true;
      button.textContent = '작전 연결 중…';
    }
    try {
      await network.switchOperation(result.nextOperationId);
      closeModal();
      game.scene.getScene('WorldScene').scene.restart();
    } catch {
      if (button) {
        button.disabled = false;
        button.textContent = '다시 연결';
      }
      showToast('다음 작전 연결에 실패했습니다. 쉘터에서 다시 시도하십시오.');
    }
  });
}

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  dispatchTacticalCommand(commandInput.value);
});
tacticalMenuButton.addEventListener('click', () => {
  setTacticalPaletteOpen(tacticalPalette.classList.contains('hidden'));
});
closeTacticalPaletteButton.addEventListener('click', () => setTacticalPaletteOpen(false, true));
tacticalPalette.querySelectorAll<HTMLButtonElement>('[data-tactical-command]').forEach((button) => {
  button.addEventListener('click', () => {
    dispatchTacticalCommand(button.dataset.tacticalCommand ?? '');
    tacticalMenuButton.focus();
  });
});
commandInput.addEventListener('focus', () => {
  commandForm.classList.add('input-active');
  setTacticalPaletteOpen(false);
  gameEvents.emit('text-input-active', true);
});
commandInput.addEventListener('blur', () => {
  commandForm.classList.remove('input-active');
  gameEvents.emit('text-input-active', false);
});
commandInput.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    commandInput.blur();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (tacticalPalette.classList.contains('hidden')) return;
  const target = event.target;
  if (target instanceof Node && (tacticalPalette.contains(target) || commandForm.contains(target))) return;
  setTacticalPaletteOpen(false);
});

byId('shelterButton').addEventListener('click', renderShelter);
byId('contractsButton').addEventListener('click', () => { void renderContracts(); });
byId('rosterButton').addEventListener('click', renderRoster);
storeButton.addEventListener('click', () => { void renderStore(); });
byId('guideButton').addEventListener('click', () => renderTutorial(0));
byId('alphaButton').addEventListener('click', renderAlphaInfo);
byId('settingsButton').addEventListener('click', renderSettings);
closeModalButton.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (event) => {
  if (event.target === modalBackdrop && currentModal !== 'game-over') closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !tacticalPalette.classList.contains('hidden')) {
    event.preventDefault();
    setTacticalPaletteOpen(false, true);
    return;
  }
  if (modalBackdrop.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    if (currentModal === 'game-over') return;
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = modalFocusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    closeModalButton.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const focusOutsideModal = !(active instanceof HTMLElement) || !modalBackdrop.contains(active);
  if (event.shiftKey && (active === first || focusOutsideModal)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || focusOutsideModal)) {
    event.preventDefault();
    first.focus();
  }
});

const muteButton = byId<HTMLButtonElement>('muteButton');
muteButton.addEventListener('click', () => {
  settings = { ...settings, sound: !settings.sound };
  applySettings();
  if (settings.sound) sound.play('ui');
});

window.addEventListener('pointerdown', () => { void sound.unlock(); }, { once: true });
window.addEventListener('keydown', () => { void sound.unlock(); }, { once: true });

document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => {
  const direction = button.dataset.move as 'up' | 'down' | 'left' | 'right';
  const setDirection = (active: boolean) => { mobileInput[direction] = active; };
  button.addEventListener('pointerdown', () => setDirection(true));
  button.addEventListener('pointerup', () => setDirection(false));
  button.addEventListener('pointercancel', () => setDirection(false));
  button.addEventListener('pointerleave', () => setDirection(false));
});
const fireButton = byId<HTMLButtonElement>('fireButton');
fireButton.addEventListener('pointerdown', () => { mobileInput.fire = true; });
['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => fireButton.addEventListener(name, () => { mobileInput.fire = false; }));
dodgeButton.addEventListener('pointerdown', () => { mobileInput.dash = true; });
byId<HTMLButtonElement>('extractButton').addEventListener('pointerdown', () => { mobileInput.extract = true; });
neuralLinkButton.addEventListener('click', () => gameEvents.emit('neural-link-request'));

document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach((button) => {
  button.addEventListener('click', () => gameEvents.emit('weapon-select', button.dataset.weapon));
});

gameEvents.on('feed', addFeed);
gameEvents.on('sfx', (name: GameSfx) => sound.play(name));
gameEvents.on('haptic', (kind: 'shot' | 'light' | 'heavy' | 'warning' | 'success') => {
  if (!settings.haptics || !('vibrate' in navigator)) return;
  const patterns: Record<typeof kind, number | number[]> = {
    shot: 8,
    light: 14,
    heavy: [22, 22, 34],
    warning: [35, 45, 35],
    success: [18, 30, 18, 30, 45],
  };
  navigator.vibrate(patterns[kind]);
});
gameEvents.on('operator-reply', (operator: ReturnType<typeof getOperator>, reply: string) => {
  addFeed(`${operator.callsign}: ${reply}`);
  showToast(`${operator.name} // ${reply}`);
  renderPersistentHud();
});
gameEvents.on('tactical-result', (feedback: TacticalCommandFeedback) => applyTacticalFeedback(feedback));
gameEvents.on('neural-link-activated', (operatorId: string, skillName: string) => {
  showNeuralCutin(operatorId, skillName);
  showToast(`${getOperator(operatorId).name} // ${skillName}`);
});
gameEvents.on('boss-intro', showBossIntro);
gameEvents.on('operation-update', (status: OperationStatus) => {
  const definition = operationDefinition(status.operationId);
  const stage = operationStageBrief(status.operationId, status.stage);
  const stageNumber = operationStageIndex(status.operationId, status.stage) + 1;
  operationAnnouncement.textContent = `작전 단계 ${stageNumber}: ${stage.label}. ${stage.district}. ${stage.directive}`;
  window.clearTimeout(stageBannerTimer);
  if (status.stage === 'WARDEN' || status.stage === 'COMPLETE') {
    stageBanner.classList.remove('active');
    stageBanner.setAttribute('aria-hidden', 'true');
    return;
  }
  stageBannerCode.textContent = `STAGE ${stageNumber.toString().padStart(2, '0')} // ${stage.label}`;
  stageBannerDistrict.textContent = stage.district;
  stageBannerDirective.textContent = stage.directive;
  stageBanner.style.setProperty('--stage-accent', `#${definition.palette.accent.toString(16).padStart(6, '0')}`);
  stageBanner.setAttribute('aria-hidden', 'false');
  stageBanner.classList.remove('active');
  void stageBanner.offsetWidth;
  stageBanner.classList.add('active');
  stageBannerTimer = window.setTimeout(() => {
    stageBanner.classList.remove('active');
    stageBanner.setAttribute('aria-hidden', 'true');
  }, settings.reducedMotion ? 1_050 : 2_800);
});
gameEvents.on('state-changed', renderPersistentHud);
gameEvents.on('game-over', renderGameOver);
gameEvents.on('operation-complete', (result: {
  operationId: OperationId; codename: string; title: string; narrative: string;
  kills: number; collected: number; weapon: string; online: boolean; bonusCores: number; bonusData: number;
  nextOperationId: OperationId;
}) => {
  renderOperationDebrief(result);
  void network.track('operation_complete', {
    operationId: result.operationId, kills: result.kills, collected: result.collected,
    weapon: result.weapon, online: result.online,
  });
});
gameEvents.on('weapon-selected', (weapon: WeaponId) => {
  document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach((button) => {
    const selected = button.dataset.weapon === weapon;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const spec = WEAPON_SPECS[weapon];
  showToast(`${spec.name} // ${spec.description}`);
});
gameEvents.on('network-profile', (profile: PlayerProfile) => {
  latestProfile = profile;
  const previous = state.snapshot();
  const previousSquad = previous.squad.join('|');
  const previousGear = previous.gear.equipped.join('|');
  state.applyServerProfile(profile);
  byId('founderBadge').classList.toggle('hidden', !profile.commerce.entitlements.includes('founder_badge'));
  if (previousSquad !== profile.squad.join('|')) gameEvents.emit('squad-changed');
  if (previousGear !== profile.gear.equipped.join('|')) gameEvents.emit('loadout-changed');
  renderPersistentHud();
  if (currentModal === 'shelter') renderShelter();
  if (currentModal === 'contracts') void renderContracts();
  if (currentModal === 'roster') renderRoster();
  if (currentModal === 'deep-talk' && rosterSelection) renderDeepTalk(rosterSelection);
  if (currentModal === 'store') void renderStore();
  void syncAiConsent();
});
gameEvents.on('network-status', (status: 'online' | 'offline' | 'connecting' | 'reconnecting', label: string) => {
  serverStatus.className = `server-status ${status}`;
  serverStatus.textContent = `● ${label}`;
});
gameEvents.on('performance-sample', (sample: PerformanceSample) => {
  performanceStatus = sample;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    gameEvents.emit('suspend-world-input');
    game.loop.sleep();
  } else {
    game.loop.wake();
    void network.resumeConnection();
  }
});
window.addEventListener('online', () => { void network.resumeConnection(); });
installGlobalErrorReporting((error) => network.reportClientError(error));
gameEvents.on('hud-update', (hud: {
  hp: number;
  radiation: number;
  cargo: Record<string, number>;
  kills: number;
  mission: Mission;
  operation: OperationStatus;
  weapon: WeaponId;
  linkCharge: number;
  linkLeader: string;
  dashCooldownMs: number;
  position: { x: number; y: number };
  activeObjectiveIds: string[];
  boss: { hp: number; maxHp: number; name: string } | null;
}) => {
  const safeHp = Math.max(0, Math.min(100, Number.isFinite(hud.hp) ? hud.hp : 0));
  hpText.textContent = `${Math.ceil(safeHp)}%`;
  hpBar.style.width = `${safeHp}%`;
  radiationText.textContent = hud.radiation > 75 ? '위험' : hud.radiation > 30 ? '상승' : '안정';
  radiationBar.style.width = `${hud.radiation}%`;
  missionText.innerHTML = `<strong>${hud.operation.code}</strong> · ${hud.operation.title}`;
  operationCode.textContent = hud.operation.code;
  operationTitle.textContent = hud.operation.title;
  operationObjective.textContent = hud.operation.objective;
  operationProgress.style.width = `${Math.min(100, hud.operation.target <= 0 ? 0 : hud.operation.current / hud.operation.target * 100)}%`;
  const definition = operationDefinition(hud.operation.operationId);
  const activeStageIndex = operationStageIndex(hud.operation.operationId, hud.operation.stage);
  const activeStage = operationStageBrief(hud.operation.operationId, hud.operation.stage);
  const stageKey = `${hud.operation.operationId}:${hud.operation.stage}`;
  if (tacticalStageKey !== stageKey) {
    tacticalStageKey = stageKey;
    operationStageRail.innerHTML = definition.stages.map((stage, index) => `
      <i class="${index < activeStageIndex ? 'complete' : index === activeStageIndex ? 'active' : ''}"
        title="${stage.label} // ${stage.district}" aria-hidden="true"><span>${index + 1}</span></i>
    `).join('');
    operationStageRail.setAttribute(
      'aria-label',
      `작전 스테이지 ${activeStageIndex + 1}/${definition.stages.length}: ${activeStage.label}, ${activeStage.district}`,
    );
  }
  const px = Math.max(0, Math.min(WORLD_SIZE, Number.isFinite(hud.position.x) ? hud.position.x : WORLD_SIZE / 2));
  const py = Math.max(0, Math.min(WORLD_SIZE, Number.isFinite(hud.position.y) ? hud.position.y : WORLD_SIZE / 2));
  const sector = nearestWorldSector(hud.operation.operationId, { x: px, y: py });
  const stageSectors = worldStageSectors(hud.operation.operationId, hud.operation.stage);
  const liveTargetIds = new Set(hud.activeObjectiveIds);
  const liveTargets = stageSectors.filter((item) => liveTargetIds.has(item.id));
  const target = liveTargets.length > 0
    ? liveTargets.reduce((nearest, candidate) => (
      Math.hypot(candidate.x - px, candidate.y - py) < Math.hypot(nearest.x - px, nearest.y - py)
        ? candidate
        : nearest
    ))
    : nearestWorldStageSector(hud.operation.operationId, hud.operation.stage, { x: px, y: py });
  const deltaX = target.x - px;
  const deltaY = target.y - py;
  const distance = Math.hypot(deltaX, deltaY);
  const bearing = (Math.atan2(deltaX, -deltaY) * 180 / Math.PI + 360) % 360;
  const direction = compassDirections[Math.round(bearing / 45) % compassDirections.length];
  mapDistrict.textContent = `${sector.code} // ${sector.label}`;
  mapCoordinates.textContent = `X ${Math.round(px).toString().padStart(4, '0')} · Y ${Math.round(py).toString().padStart(4, '0')}`;
  mapDirective.textContent = activeStage.directive;
  mapTarget.textContent = `${direction} ${target.label} · ${Math.round(distance)}m`;
  mapTarget.title = `${target.label}까지 ${Math.round(distance)}m`;
  mapTarget.setAttribute('aria-label', `${direction}, ${target.label}까지 ${Math.round(distance)}미터`);
  mapBearing.style.transform = `rotate(${bearing}deg)`;
  mapPlayer.style.left = `${px / WORLD_SIZE * 100}%`;
  mapPlayer.style.top = `${py / WORLD_SIZE * 100}%`;
  mapRouteLine.setAttribute('x1', String(px / WORLD_SIZE * 100));
  mapRouteLine.setAttribute('y1', String(py / WORLD_SIZE * 100));
  mapRouteLine.setAttribute('x2', String(target.x / WORLD_SIZE * 100));
  mapRouteLine.setAttribute('y2', String(target.y / WORLD_SIZE * 100));
  const mapKey = `${stageKey}:${[...liveTargetIds].sort().join(',')}:${target.id}`;
  if (tacticalMapKey !== mapKey) {
    tacticalMapKey = mapKey;
    mapObjectives.innerHTML = worldSectors(hud.operation.operationId).map((item) => `
      <i class="map-objective ${item.kind} ${liveTargetIds.has(item.id) ? 'active' : ''} ${item.id === target.id ? 'target' : ''}"
        style="left:${item.x / WORLD_SIZE * 100}%;top:${item.y / WORLD_SIZE * 100}%"
        title="${item.code} // ${item.label}"></i>
    `).join('');
  }
  operationCount.textContent = hud.operation.stage === 'WARDEN' ? '보스 신호 고정'
    : hud.operation.stage === 'RELAY' ? '신경 중계기 파괴'
    : hud.operation.stage === 'EXTRACT' ? '쉘터 리프트로 복귀'
      : `${Math.min(hud.operation.current, hud.operation.target)} / ${hud.operation.target}`;
  const rawCharge = Number.isFinite(hud.linkCharge) ? hud.linkCharge : 0;
  const charge = Math.max(0, Math.min(100, Math.floor(rawCharge)));
  neuralLinkBar.style.width = `${charge}%`;
  neuralLinkChargeText.textContent = `${charge}%`;
  neuralLinkButton.disabled = charge < 100;
  neuralLinkButton.classList.toggle('ready', charge >= 100);
  dodgeButton.disabled = hud.dashCooldownMs > 0;
  dodgeButton.textContent = hud.dashCooldownMs > 0 ? `${Math.ceil(hud.dashCooldownMs / 100) / 10}s` : 'DODGE';
  if (currentLinkLeader !== hud.linkLeader) {
    currentLinkLeader = hud.linkLeader;
    const leader = getOperator(hud.linkLeader);
    neuralLinkPortrait.src = leader.portrait;
    neuralLinkSkillText.textContent = neuralLinkSkill(hud.linkLeader).name;
  }
  bossHud.classList.toggle('hidden', !hud.boss);
  tacticalMap.classList.toggle('boss-active', Boolean(hud.boss));
  if (hud.boss) {
    const bossMaxHp = Math.max(1, Number.isFinite(hud.boss.maxHp) ? hud.boss.maxHp : 1);
    const bossHp = Math.max(0, Math.min(bossMaxHp, Number.isFinite(hud.boss.hp) ? hud.boss.hp : 0));
    bossHudName.textContent = hud.boss.name;
    bossHpBar.style.width = `${bossHp / bossMaxHp * 100}%`;
    bossHpText.textContent = `${Math.ceil(bossHp)} / ${Math.ceil(bossMaxHp)}`;
    bossHpProgress.setAttribute('aria-label', `${hud.boss.name} 체력`);
    bossHpProgress.setAttribute('aria-valuemax', String(Math.ceil(bossMaxHp)));
    bossHpProgress.setAttribute('aria-valuenow', String(Math.ceil(bossHp)));
    bossHpProgress.setAttribute('aria-valuetext', `${Math.ceil(bossHp)} / ${Math.ceil(bossMaxHp)}`);
  }
});

resetTacticalStatus();
applySettings();
renderPersistentHud();
if (state.offlineReward.elapsedMinutes >= 2) {
  showToast(`오프라인 ${state.offlineReward.elapsedMinutes}분 회수 // 고철 ${state.offlineReward.scrap} · 식수 ${state.offlineReward.water}`);
}
if (!settings.consentReviewed) window.setTimeout(() => renderPrivacyCenter(), 320);
else if (!settings.tutorialComplete) window.setTimeout(() => renderTutorial(0), 450);
void network.connect(state.activeOperationId());

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // Installation remains optional when the host blocks service workers.
    });
  });
}
