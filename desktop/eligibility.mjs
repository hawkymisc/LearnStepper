export function createEligibilityGate(startHost) {
  let acknowledged = false;
  let initialization = null;

  return {
    get acknowledged() {
      return acknowledged;
    },

    confirm() {
      acknowledged = true;
      if (initialization) return initialization;

      const attempt = Promise.resolve().then(startHost);
      initialization = attempt;
      void attempt.catch(() => {
        if (initialization === attempt) initialization = null;
      });
      return attempt;
    },

    requireReady() {
      if (!acknowledged) {
        return Promise.reject(new Error("Adult eligibility confirmation is required"));
      }
      if (!initialization) {
        return Promise.reject(new Error("LearnStepper host initialization is not ready"));
      }
      return initialization;
    },
  };
}
