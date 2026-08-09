export async function initializeWithCleanup(
  initialize: () => Promise<void>,
  cleanup: () => void,
): Promise<void> {
  try {
    await initialize();
  } catch (initializationError: unknown) {
    try {
      cleanup();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [initializationError, cleanupError],
        "Renderer initialization and cleanup both failed",
      );
    }
    throw initializationError;
  }
}
