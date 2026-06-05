import { startLocalApiServer } from "../server/localApiServer";

const port = Number(process.env.AIALL_BACKEND_PORT || 37891);

startLocalApiServer({ port }).catch((error) => {
  console.error("[aiall-backend] failed to start:", error);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
