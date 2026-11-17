// The whole-process network test harness (SEC-4, D33). See specs/evals.md.
// Wave 2 runs the real `vix` through runUnderObservation.

export {
  type Destination,
  destinationFromUrl,
  isAllowedDestination,
  parseEndpoint,
} from "./destinations.ts";
export {
  countOutboundDestinations,
  type ObservedRun,
  type ObservedRunOptions,
  runUnderObservation,
  type Violation,
} from "./observed-run.ts";
export { type ProxyRecord, type RecordingProxy, startRecordingProxy } from "./recording-proxy.ts";
export {
  listConnectedSockets,
  parseLsofFields,
  processTree,
  type SocketRecord,
  startSocketMonitor,
} from "./socket-monitor.ts";
