import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_AFFORDANCE_IDS,
  ROOM_CONNECTIONS,
  WORLD_REGISTRY,
  areRoomsConnected,
  canUseWorldObject,
  connectedRooms,
  isActionAffordance,
  isObjectSpotValid,
  isRoomId,
  isSpot,
  isWorldRegistryValid,
  validateWorldReference,
  validateWorldRegistry,
} from '../shared/world-registry.js';

test('注册表沿用六个 canonical 房间并形成连通图', () => {
  assert.equal(WORLD_REGISTRY.roomIds.length, 6);
  assert.equal(isWorldRegistryValid(), true);
  assert.ok(ROOM_CONNECTIONS.length >= 5);
  assert.ok(areRoomsConnected('bedroom', 'corridor'));
  assert.ok(areRoomsConnected('corridor', 'bedroom'));
  assert.ok(connectedRooms('corridor').includes('office'));
  assert.equal(areRoomsConnected('bedroom', 'bar'), false);
});

test('物件、站位和角色 affordance 共用 002 白名单', () => {
  assert.equal(isRoomId('bedroom'), true);
  assert.equal(isSpot('bedroom', 'bed'), true);
  assert.equal(isSpot('bedroom', 'desk'), false);
  assert.equal(isObjectSpotValid('bedroom', 'lamp'), true);
  assert.equal(canUseWorldObject('A', 'villain', 'door', 'slam'), false);
  assert.equal(canUseWorldObject('bedroom', 'A', 'door', 'slam'), true);
  assert.equal(canUseWorldObject('bedroom', 'A', 'phone', 'slam'), false);
  assert.equal(isActionAffordance('ambient', 'ENV'), true);
  assert.equal(isActionAffordance('ambient', 'A'), false);
  assert.ok(ACTION_AFFORDANCE_IDS.includes('use'));
});

test('跨房间与未知引用整体拒绝', () => {
  assert.deepEqual(validateWorldReference({ roomId: 'bedroom', toRoomId: 'corridor' }), { valid: true, errors: [] });
  assert.equal(validateWorldReference({ roomId: 'bedroom', toRoomId: 'bar' }).valid, false);
  assert.equal(validateWorldReference({ roomId: 'bedroom', objectId: 'phone', actor: 'YOU', verb: 'check' }).valid, true);
  const invalid = validateWorldReference({ roomId: 'bedroom', objectId: 'unknown', action: 'hack', actor: 'A', verb: 'read' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes('unknown-object'));
  assert.ok(invalid.errors.includes('unknown-action'));
  assert.ok(invalid.errors.includes('invalid-object-affordance'));
});

test('注册表自检能报告缺失物件站位，而不修改 canonical 数据', () => {
  const broken = {
    ...WORLD_REGISTRY,
    roomIds: [...WORLD_REGISTRY.roomIds, 'missing'],
    rooms: { ...WORLD_REGISTRY.rooms },
    roomSpots: { ...WORLD_REGISTRY.roomSpots },
    objects: { ...WORLD_REGISTRY.objects, bedroom: [{ id: 'bad', verbs: ['open'], spot: 'not-a-spot' }] },
  };
  const result = validateWorldRegistry(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('missing-room:missing'));
  assert.ok(result.errors.includes('invalid-object-spot:bedroom:bad'));
  assert.equal(WORLD_REGISTRY.objects.bedroom[0].id, 'lamp');
});
