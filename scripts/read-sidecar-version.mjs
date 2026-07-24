#!/usr/bin/env node

import { checkRelease } from './check-release.mjs';

const result = await checkRelease();
process.stdout.write(result.sidecarVersion);
