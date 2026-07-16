import 'dotenv/config';
import { createGameServer } from './createServer.js';
import { loadServerConfig } from './config/env.js';

const config = loadServerConfig();
const { gameServer } = createGameServer(config);

await gameServer.listen(config.port, config.host);
console.log(`Neural Evolution server listening on http://${config.host}:${config.port}`);
