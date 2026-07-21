export function createAuthenticationRefresher({ createSidecar, getCurrent, setCurrent, activate }) {
  let inFlight;

  return function refreshAuthentication() {
    if (inFlight) return inFlight;
    let operation;
    operation = (async () => {
      let candidate;
      try {
        candidate = await createSidecar();
        const result = await candidate.refreshAuthentication();
        const previous = getCurrent();
        activate(candidate);
        setCurrent(candidate);
        previous?.retire();
        return { state: result.state };
      } catch (error) {
        candidate?.close();
        throw error;
      } finally {
        if (inFlight === operation) inFlight = undefined;
      }
    })();
    inFlight = operation;
    return operation;
  };
}
