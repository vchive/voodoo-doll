import test from 'node:test';
import assert from 'node:assert/strict';

import { PlayApiClient } from '../hex/play-api.ts';
import { createLocalSaveEnvelope, emptyLocalState } from '../hex/play-state.ts';

function importRecorder() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      snapshot: { worldVersion: 1, roomId: 'office', present: ['YOU'] },
      profile: { dollName: '小墨', names: {} },
      modelEnabled: false,
    }), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, client: new PlayApiClient('/api/v4', fetchImpl) };
}

test('离线导出的单人存档带明确来源并按单人格式重新导入', async () => {
  const state = emptyLocalState();
  state.profile = { dollName: '小墨', story: '办公室里的旧故事', names: { A: '林川' } };
  state.snapshot.roomId = 'office';
  state.snapshot.worldVersion = 7;
  const envelope = createLocalSaveEnvelope(state);
  const { calls, client } = importRecorder();

  await client.importSave(envelope);

  assert.equal(envelope.sourceKey, 'voodoo-single-v1');
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v4/play/save/import');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sourceKey: 'voodoo-single-v1',
    payload: envelope.payload,
  });
});

test('旧版裸 LocalState 离线导出仍推断为单人存档', async () => {
  const legacyOfflineExport = emptyLocalState();
  legacyOfflineExport.profile = { dollName: '旧墨', story: '旧文件仍能回来', names: {} };
  const { calls, client } = importRecorder();

  await client.importSave(legacyOfflineExport);

  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sourceKey: 'voodoo-single-v1',
    payload: legacyOfflineExport,
  });
});
