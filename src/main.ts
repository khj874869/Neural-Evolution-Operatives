import Phaser from 'phaser';
import './styles.css';
import { gameConfig } from './game/config';
import { getOperator, type OperatorRole } from './game/data/operators';
import { gameEvents, type MobileInputState } from './game/events';
import { GameServerClient } from './game/network/GameServerClient';
import { GameState, type ShelterModules } from './game/state/GameState';
import type { Mission } from './game/systems/MissionGenerator';
import type { PlayerProfile } from '../packages/shared/src/protocol';
import { describeSquadBonuses } from '../packages/shared/src/squad';

const state = new GameState();
const mobileInput: MobileInputState = { up: false, down: false, left: false, right: false, fire: false };
const network = new GameServerClient();
const game = new Phaser.Game(gameConfig);
game.registry.set('state', state);
game.registry.set('mobileInput', mobileInput);
game.registry.set('network', network);

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
const eventFeed = byId<HTMLDivElement>('eventFeed');
const modalBackdrop = byId<HTMLDivElement>('modalBackdrop');
const modalContent = byId<HTMLDivElement>('modalContent');
const commandForm = byId<HTMLFormElement>('commandForm');
const commandInput = byId<HTMLInputElement>('commandInput');
const toast = byId<HTMLDivElement>('toast');
let currentModal: 'shelter' | 'roster' | 'game-over' | null = null;
let rosterSelection: string | null = null;
let squadDraft: string[] = [];

const labels = { scrap: '고철', water: '식수', data: '데이터', cores: '코어' } as const;
const icons = { scrap: '▰', water: '◒', data: '◇', cores: '◈' } as const;
const roleMetrics: Record<OperatorRole, Array<{ label: string; value: number }>> = {
  Vanguard: [{ label: '돌파', value: 88 }, { label: '방어', value: 92 }, { label: '지원', value: 42 }],
  Sniper: [{ label: '화력', value: 96 }, { label: '기동', value: 58 }, { label: '지원', value: 45 }],
  Support: [{ label: '화력', value: 48 }, { label: '생존', value: 76 }, { label: '지원', value: 95 }],
  Engineer: [{ label: '화력', value: 62 }, { label: '회수', value: 94 }, { label: '지원', value: 78 }],
};

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
  modalBackdrop.classList.add('hidden');
  currentModal = null;
  gameEvents.emit('resume-world');
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
byId('closeModal').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (event) => {
  if (event.target === modalBackdrop && currentModal !== 'game-over') closeModal();
});

let soundEnabled = true;
const muteButton = byId<HTMLButtonElement>('muteButton');
muteButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  muteButton.textContent = soundEnabled ? 'SFX ON' : 'SFX OFF';
  game.sound.mute = !soundEnabled;
});

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

gameEvents.on('feed', addFeed);
gameEvents.on('operator-reply', (operator: ReturnType<typeof getOperator>, reply: string) => {
  addFeed(`${operator.callsign}: ${reply}`);
  showToast(`${operator.name} // ${reply}`);
  renderPersistentHud();
});
gameEvents.on('state-changed', renderPersistentHud);
gameEvents.on('game-over', renderGameOver);
gameEvents.on('network-profile', (profile: PlayerProfile) => {
  const previousSquad = state.snapshot().squad.join('|');
  state.applyServerProfile(profile);
  if (previousSquad !== profile.squad.join('|')) gameEvents.emit('squad-changed');
  renderPersistentHud();
  if (currentModal === 'shelter') renderShelter();
  if (currentModal === 'roster') renderRoster();
});
gameEvents.on('network-status', (status: 'online' | 'offline' | 'connecting', label: string) => {
  serverStatus.className = `server-status ${status}`;
  serverStatus.textContent = `● ${label}`;
});
gameEvents.on('hud-update', (hud: { hp: number; radiation: number; cargo: Record<string, number>; kills: number; mission: Mission }) => {
  hpText.textContent = `${Math.ceil(hud.hp)}%`;
  hpBar.style.width = `${hud.hp}%`;
  radiationText.textContent = hud.radiation > 75 ? '위험' : hud.radiation > 30 ? '상승' : '안정';
  radiationBar.style.width = `${hud.radiation}%`;
  missionText.innerHTML = `<strong>${hud.mission.codename}</strong> · 제거 ${hud.kills}/${hud.mission.targetKills} · 현장 고철 ${hud.cargo.scrap ?? 0}`;
});

renderPersistentHud();
if (state.offlineReward.elapsedMinutes >= 2) {
  showToast(`오프라인 ${state.offlineReward.elapsedMinutes}분 회수 // 고철 ${state.offlineReward.scrap} · 식수 ${state.offlineReward.water}`);
}
void network.connect();
