// Safety net, loaded before every test file (see bunfig.toml): no test may touch the real ~/.pi/agent.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-test-agent-"));
