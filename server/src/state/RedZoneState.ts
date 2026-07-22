import { MapSchema, Schema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  playerId = '';
  displayName = '';
  x = 0;
  y = 0;
  aimAngle = 0;
  hp = 100;
  radiation = 0;
  cargoScrap = 0;
  cargoWater = 0;
  cargoData = 0;
  cargoCores = 0;
  kills = 0;
  lastSequence = 0;
  linkCharge = 0;
  dashCooldownMs = 0;
}
defineTypes(PlayerState, {
  playerId: 'string', displayName: 'string', x: 'number', y: 'number', aimAngle: 'number',
  hp: 'number', radiation: 'number', cargoScrap: 'number', cargoWater: 'number',
  cargoData: 'number', cargoCores: 'number', kills: 'uint16', lastSequence: 'uint32', linkCharge: 'uint8',
  dashCooldownMs: 'uint16',
});

export class EnemyState extends Schema {
  kind = 'raider';
  x = 0;
  y = 0;
  hp = 0;
}
defineTypes(EnemyState, { kind: 'string', x: 'number', y: 'number', hp: 'number' });

export class ResourceState extends Schema {
  kind = 'scrap';
  x = 0;
  y = 0;
  value = 0;
}
defineTypes(ResourceState, { kind: 'string', x: 'number', y: 'number', value: 'uint16' });

export class RedZoneState extends Schema {
  players = new MapSchema<PlayerState>();
  enemies = new MapSchema<EnemyState>();
  resources = new MapSchema<ResourceState>();
  stormActive = false;
  operationId = 'operation-zero';
  relaysDestroyed = 0;
  bossDefeated = false;
  serverTime = 0;
}
defineTypes(RedZoneState, {
  players: { map: PlayerState },
  enemies: { map: EnemyState },
  resources: { map: ResourceState },
  stormActive: 'boolean',
  operationId: 'string',
  relaysDestroyed: 'uint8',
  bossDefeated: 'boolean',
  serverTime: 'number',
});
