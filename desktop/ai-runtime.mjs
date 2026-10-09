/** Composition root for optional capabilities. The existing repository remains the only writer. */
export async function createAIRuntime(options) {
  const [{ createAIService }, { createAIAutomation }, { createAIHTTP }] =
    await Promise.all([
      import("./ai-service.mjs"),
      import("./ai-automation.mjs"),
      import("./ai-http.mjs"),
    ]);
  const service = await createAIService(options);
  const automation = await createAIAutomation({ ...options, service });
  const http = await createAIHTTP({ ...options, service, automation });
  try {
    await service.init();
    await automation.init();
    await http.init();
  } catch (error) {
    await http.close();
    await automation.close();
    await service.close();
    throw error;
  }
  // Deliberate dispatch table: adding a backend method does not automatically expose it to a renderer.
  const actions = {
    state: async () => ({
      settings: await service.getSettings(),
      tasks: await automation.list(),
      http: await http.status(),
    }),
    saveSettings: (input) => service.saveSettings(input),
    test: () => service.testConnection(),
    run: async (input) => {
      try {
        return await service.run(input);
      } catch (error) {
        // IPC Error serialization drops custom fields, so preserve completed tool
        // results explicitly. Cancelling a model cannot undo already committed files.
        return {
          failed: true,
          error: error.message,
          text: "本次执行中断，已经完成的知识库操作保留。",
          toolResults: error.toolResults || [],
          references: error.references || [],
        };
      }
    },
    cancel: () => service.cancel(),
    semantic: (input) => service.semanticSearch(input),
    guide: () => service.guide(),
    tasks: () => automation.list(),
    saveTask: (input) => automation.save(input),
    removeTask: (id) => automation.remove(id),
    runTask: (id) => automation.runNow(id),
    configureHTTP: (input) => http.configure(input),
  };
  return {
    call(name, ...args) {
      if (!Object.hasOwn(actions, name)) throw Error("未知 AI 操作");
      return actions[name](...args);
    },
    async close() {
      await http.close();
      await automation.close();
      await service.close();
    },
  };
}
