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
import type { OperationStatus } from './game/systems/OperationZero';
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
const sound = new SoundEngine();
sound.setEnabled(settings.sound);
const game = new Phaser.Game(gameConfig);
game.registry.set('state', state);
game.registry.set('mobileInput', mobileInput);
game.registry.set('network', network);
game.registry.set('settings', settings);

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
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
const bossHud = byId<HTMLElement>('bossHud');
const bossHpBar = byId<HTMLElement>('bossHpBar');
const bossHpText = byId<HTMLElement>('bossHpText');
const eventFeed = byId<HTMLDivElement>('eventFeed');
const modalBackdrop = byId<HTMLDivElement>('modalBackdrop');
const modalContent = byId<HTMLDivElement>('modalContent');
const commandForm = byId<HTMLFormElement>('commandForm');
const commandInput = byId<HTMLInputElement>('commandInput');
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
const dodgeButton = byId<HTMLButtonElement>('dodgeButton');
let currentModal: 'shelter' | 'roster' | 'store' | 'alpha' | 'settings' | 'privacy' | 'tutorial' | 'game-over' | 'operation-complete' | null = null;
let rosterSelection: string | null = null;
let squadDraft: string[] = [];
let latestProfile: PlayerProfile | null = null;
let currentLinkLeader = '';
let cutinTimer = 0;
let bossIntroTimer = 0;

releaseBadge.textContent = `${CLIENT_RELEASE.channel.toUpperCase()} ${CLIENT_RELEASE.version}`;
releaseBadge.title = '비공개 테스트 빌드';
document.body.dataset.releaseChannel = CLIENT_RELEASE.channel;
storeButton.classList.toggle('hidden', !CLIENT_RELEASE.commerceEnabled);

const labels = { scrap: '고철', water: '식수', data: '데이터', cores: '코어' } as const;
const icons = { scrap: '▰', water: '◒', data: '◇', cores: '◈' } as const;
const roleMetrics: Record<OperatorRole, Array<{ label: string; value: number }>> = {
  Vanguard: [{ label: '돌파', value: 88 }, { label: '방어', value: 92 }, { label: '지원', value: 42 }],
  Sniper: [{ label: '화력', value: 96 }, { label: '기동', value: 58 }, { label: '지원', value: 45 }],
  Support: [{ label: '화력', value: 48 }, { label: '생존', value: 76 }, { label: '지원', value: 95 }],
  Engineer: [{ label: '화력', value: 62 }, { label: '회수', value: 94 }, { label: '지원', value: 78 }],
};
const tutorialSteps = [
  { code: '01 // MOVE', icon: '⌖', title: '레드 존 이동', body: 'PC는 WASD 또는 방향키, 모바일은 왼쪽 방향 패드로 이동합니다. 멈춰 있으면 적응형 AI가 우회 병력을 투입합니다.' },
  { code: '02 // DODGE', icon: '➤', title: '긴급 회피', body: 'PC는 Space, 모바일은 DODGE로 1.8초마다 빠르게 이탈합니다. 게임패드는 B 버튼을 사용합니다.' },
  { code: '03 // ENGAGE', icon: '◎', title: '조준과 사격', body: 'PC는 마우스로 조준해 클릭하고, 모바일은 FIRE를 누르면 가장 가까운 적을 자동 조준합니다. 게임패드는 오른쪽 스틱과 A/RT를 사용합니다.' },
  { code: '04 // LOADOUT', icon: '⌁', title: '실시간 무장 전환', body: '카빈은 균형형, 파쇄포는 근거리 산탄, 코일건은 장거리 고화력 무장입니다. PC는 숫자 1·2·3, 모바일은 하단 무장 버튼으로 바꿉니다.' },
  { code: '05 // COMMAND', icon: '◇', title: '자연어 전술 명령', body: '하단 입력창에 “모두 복귀해”, “치료해줘”, “측면으로 우회해”처럼 입력하면 3인 분대가 즉시 전술을 변경합니다.' },
  { code: '06 // NEURAL LINK', icon: '◉', title: '분대 리미트 브레이크', body: '교전으로 링크 게이지를 100% 충전한 뒤 PC는 Q, 모바일은 리더 초상화 버튼을 누르세요. 분대 1번 리더의 역할별 필살기가 발동합니다.' },
  { code: '07 // EXTRACT', icon: '⬡', title: '화물 추출', body: '중앙 쉘터 리프트로 돌아와 PC는 E, 모바일은 EXTRACT를 누르세요. 사망하면 현장 화물을 모두 잃습니다.' },
] as const;

function renderPersistentHud(): void {
  const save = state.snapshot();
  resourceHud.innerHTML = (Object.keys(labels) as Array<keyof typeof labels>).map((key) =>
    `<div class="resource"><span>${icons[key]} ${labels[key]}</span><b>${save.resources[key].toLocaleString()}</b></div>`,
  ).join('');
  squadHud.innerHTML = `<div class="squad-title">SQUAD // NEURAL LINK</div>${state.getSquad().map(({ definition, owned }) => `
    <div class="operative-chip">
      <img class="op-avatar" src="${definition.portrait}" alt="${definition.name}" loading="eager" />
      <div><b>${definition.callsign}</b><small>${definition.role} · LINK ${owned.bond}%</small></div>
      <span class="rarity ${definition.rarity}">${definition.rarity}</span>
    </div>`).join('')}`;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
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

function showBossIntro(): void {
  window.clearTimeout(bossIntroTimer);
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
  const line = document.createElement('div');
  line.textContent = `> ${message}`;
  if (danger) line.className = 'danger';
  eventFeed.prepend(line);
  while (eventFeed.children.length > 5) eventFeed.lastElementChild?.remove();
}

function pauseForModal(): void {
  if (game.scene.isActive('WorldScene')) game.scene.pause('WorldScene');
  modalBackdrop.classList.remove('hidden');
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
  currentModal = null;
  sound.play('ui');
  gameEvents.emit('resume-world');
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

function renderSettings(): void {
  currentModal = 'settings';
  pauseForModal();
  const toggles: Array<{ key: 'sound' | 'haptics' | 'reducedMotion' | 'analyticsConsent'; label: string; description: string }> = [
    { key: 'sound', label: '전투 사운드', description: '사격, 타격, 환경 경보와 UI 합성음을 재생합니다.' },
    { key: 'haptics', label: '모바일 진동', description: '사격, 피격, 획득과 추출 순간에 촉각 피드백을 제공합니다.' },
    { key: 'reducedMotion', label: '모션 감소', description: '화면 흔들림과 전투 파티클 수를 줄여 멀미와 발열을 완화합니다.' },
    { key: 'analyticsConsent', label: '선택 분석 데이터', description: '개인 대화 내용 없이 진행·오류 이벤트만 전송합니다. 언제든 끌 수 있습니다.' },
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
    <div class="settings-actions">
      <button id="replayTutorial">튜토리얼 다시 보기</button>
      <button id="openPrivacy">개인정보·AI 안내</button>
      <button class="primary" id="closeSettings">설정 완료</button>
    </div>`;
  modalContent.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.setting as 'sound' | 'haptics' | 'reducedMotion' | 'analyticsConsent';
      settings = { ...settings, [key]: !settings[key] };
      applySettings();
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
      <article><b>AI 처리 범위</b><p>현재 전술 명령과 캐릭터 응답은 안전한 규칙 엔진으로 기기에서 처리됩니다. 외부 LLM·음성 API로 대화를 전송하지 않습니다.</p></article>
    </div>
    <div class="consent-panel">선택 분석 데이터: <b>${settings.analyticsConsent ? '허용됨' : '사용 안 함'}</b><br />결제 영수증은 재화 중복 지급 방지를 위해 계정 삭제 후에도 거래 식별자만 분리 보존될 수 있습니다.</div>
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
      const payload = network.connected
        ? await network.exportAccount()
        : { schemaVersion: 1, exportedAt: new Date().toISOString(), mode: 'local', profile: state.snapshot() };
      downloadJson(`neural-operatives-data-${new Date().toISOString().slice(0, 10)}.json`, payload);
      showToast('계정 데이터 내보내기 완료');
    } catch {
      showToast('데이터를 내보내지 못했습니다. 연결 상태를 확인하세요.');
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
      if (network.connected) await network.deleteAccount();
      clearLocalAccount();
      window.location.reload();
    } catch {
      deleteButton.disabled = false;
      deleteButton.textContent = '계정 영구 삭제';
      showToast('계정을 삭제하지 못했습니다. 서버 연결을 확인하세요.');
    }
  });
  modalContent.querySelector<HTMLButtonElement>('#privacyDone')?.addEventListener('click', renderSettings);
}

function renderAlphaInfo(): void {
  currentModal = 'alpha';
  pauseForModal();
  const diagnostics = {
    ...network.getDiagnostics(),
    analyticsConsent: settings.analyticsConsent,
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
    <pre class="diagnostic-preview">${escapeHtml(JSON.stringify(diagnostics, null, 2))}</pre>
    <div class="settings-actions alpha-actions">
      <button id="copyDiagnostics">진단 정보 복사</button>
      <button id="alphaPrivacy">오류 수집 설정</button>
      ${CLIENT_RELEASE.feedbackUrl ? '<button class="primary" id="openFeedback">피드백 보내기</button>' : ''}
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
  for (const key of ['neo-save-v1', 'neo-settings-v1', 'neo-settings-v2', 'neo-device-id']) localStorage.removeItem(key);
}

function renderTutorial(step: number): void {
  const safeStep = Math.max(0, Math.min(tutorialSteps.length - 1, step));
  const tutorial = tutorialSteps[safeStep];
  currentModal = 'tutorial';
  pauseForModal();
  modalContent.innerHTML = `
    <div class="tutorial-card">
      <div class="tutorial-progress">${tutorialSteps.map((_item, index) => `<i class="${index <= safeStep ? 'active' : ''}"></i>`).join('')}</div>
      <span class="eyebrow">FIELD OPERATIONS TUTORIAL // ${tutorial.code}</span>
      <div class="tutorial-icon">${tutorial.icon}</div>
      <h2>${tutorial.title}</h2>
      <p>${tutorial.body}</p>
      <div class="tutorial-keys">${safeStep === 0 ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>'
        : safeStep === 1 ? '<kbd>SPACE</kbd><kbd>DODGE</kbd>'
          : safeStep === 2 ? '<kbd>CLICK</kbd><kbd>FIRE</kbd>'
            : safeStep === 3 ? '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>'
              : safeStep === 4 ? '<kbd>TACTICAL://</kbd>'
                : safeStep === 5 ? '<kbd>Q</kbd><kbd>100%</kbd>' : '<kbd>E</kbd><kbd>EXTRACT</kbd>'}</div>
      <div class="tutorial-actions">
        <button id="skipTutorial">건너뛰기</button>
        <button class="primary" id="nextTutorial">${safeStep === tutorialSteps.length - 1 ? '작전 투입' : '다음 단계'}</button>
      </div>
    </div>`;
  modalContent.querySelector<HTMLButtonElement>('#skipTutorial')?.addEventListener('click', closeModal);
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
    <div class="recruit-panel"><div><b>방치 생산 예상치</b><div class="subtle">시간당 고철 ${Math.round(13.2 * (1 + (save.shelter.workshop - 1) * .35))} · 식수 ${Math.round(8.4 * (1 + (save.shelter.purifier - 1) * .3))}</div></div></div>`;
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
  kills: number; collected: number; weapon: string; online: boolean; bonusCores: number; bonusData: number;
}): void {
  currentModal = 'operation-complete';
  pauseForModal();
  modalContent.innerHTML = `
    <section class="debrief">
      <span class="eyebrow">OPERATION ZERO // MISSION COMPLETE</span>
      <div class="debrief-mark">S</div>
      <h2>첫 번째 생존자</h2>
      <p>감시자 케르베로스가 파괴되고 쉘터로 향하는 안전 회랑이 열렸습니다.</p>
      <div class="debrief-stats">
        <div><span>제거</span><b>${result.kills}</b></div>
        <div><span>회수</span><b>${result.collected}</b></div>
        <div><span>주력 무장</span><b>${escapeHtml(result.weapon)}</b></div>
        <div><span>판정</span><b>${result.online ? 'SERVER' : 'LOCAL'}</b></div>
      </div>
      <div class="debrief-reward"><span>작전 보너스</span><b>${result.online ? '보스 전리품 서버 확정' : `뉴럴 코어 +${result.bonusCores} · 데이터 +${result.bonusData}`}</b></div>
      <button class="primary" id="finishOperation">쉘터로 귀환</button>
    </section>`;
  modalContent.querySelector<HTMLButtonElement>('#finishOperation')?.addEventListener('click', () => {
    closeModal();
    renderShelter();
  });
}

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) return;
  gameEvents.emit('tactical-command', command);
  network.sendTactical(command);
  commandInput.value = '';
  commandInput.blur();
});

byId('shelterButton').addEventListener('click', renderShelter);
byId('rosterButton').addEventListener('click', renderRoster);
storeButton.addEventListener('click', () => { void renderStore(); });
byId('alphaButton').addEventListener('click', renderAlphaInfo);
byId('settingsButton').addEventListener('click', renderSettings);
byId('closeModal').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (event) => {
  if (event.target === modalBackdrop && currentModal !== 'game-over') closeModal();
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
gameEvents.on('neural-link-activated', (operatorId: string, skillName: string) => {
  showNeuralCutin(operatorId, skillName);
  showToast(`${getOperator(operatorId).name} // ${skillName}`);
});
gameEvents.on('boss-intro', showBossIntro);
gameEvents.on('state-changed', renderPersistentHud);
gameEvents.on('game-over', renderGameOver);
gameEvents.on('operation-complete', (result: {
  kills: number; collected: number; weapon: string; online: boolean; bonusCores: number; bonusData: number;
}) => {
  renderOperationDebrief(result);
  void network.track('operation_complete', {
    kills: result.kills, collected: result.collected, weapon: result.weapon, online: result.online,
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
  const previousSquad = state.snapshot().squad.join('|');
  state.applyServerProfile(profile);
  byId('founderBadge').classList.toggle('hidden', !profile.commerce.entitlements.includes('founder_badge'));
  if (previousSquad !== profile.squad.join('|')) gameEvents.emit('squad-changed');
  renderPersistentHud();
  if (currentModal === 'shelter') renderShelter();
  if (currentModal === 'roster') renderRoster();
  if (currentModal === 'store') void renderStore();
});
gameEvents.on('network-status', (status: 'online' | 'offline' | 'connecting', label: string) => {
  serverStatus.className = `server-status ${status}`;
  serverStatus.textContent = `● ${label}`;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.loop.sleep();
  } else {
    game.loop.wake();
  }
});
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
  boss: { hp: number; maxHp: number } | null;
}) => {
  hpText.textContent = `${Math.ceil(hud.hp)}%`;
  hpBar.style.width = `${hud.hp}%`;
  radiationText.textContent = hud.radiation > 75 ? '위험' : hud.radiation > 30 ? '상승' : '안정';
  radiationBar.style.width = `${hud.radiation}%`;
  missionText.innerHTML = `<strong>${hud.operation.code}</strong> · ${hud.operation.title}`;
  operationCode.textContent = hud.operation.code;
  operationTitle.textContent = hud.operation.title;
  operationObjective.textContent = hud.operation.objective;
  operationProgress.style.width = `${Math.min(100, hud.operation.target <= 0 ? 0 : hud.operation.current / hud.operation.target * 100)}%`;
  operationCount.textContent = hud.operation.stage === 'WARDEN' ? 'BOSS SIGNAL LOCKED'
    : hud.operation.stage === 'EXTRACT' ? 'RETURN TO SHELTER LIFT'
      : `${Math.min(hud.operation.current, hud.operation.target)} / ${hud.operation.target}`;
  const charge = Math.max(0, Math.min(100, Math.floor(hud.linkCharge)));
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
  if (hud.boss) {
    bossHpBar.style.width = `${Math.max(0, hud.boss.hp / hud.boss.maxHp * 100)}%`;
    bossHpText.textContent = `${Math.ceil(hud.boss.hp)} / ${hud.boss.maxHp}`;
  }
});

applySettings();
renderPersistentHud();
if (state.offlineReward.elapsedMinutes >= 2) {
  showToast(`오프라인 ${state.offlineReward.elapsedMinutes}분 회수 // 고철 ${state.offlineReward.scrap} · 식수 ${state.offlineReward.water}`);
}
if (!settings.consentReviewed) window.setTimeout(() => renderPrivacyCenter(), 320);
else if (!settings.tutorialComplete) window.setTimeout(() => renderTutorial(0), 450);
void network.connect();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // Installation remains optional when the host blocks service workers.
    });
  });
}
