// Silence structured logs (src/log.ts) in unit tests; tests that assert on
// log output install their own sink.
import { setLogSink } from "../log";

setLogSink(() => {});
