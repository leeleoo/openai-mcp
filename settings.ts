import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

interface ServerConfig {
  name: string;
  command: string;
  args: string[];
}

interface Settings {
  model: string;
  apiKey: string;
  baseUrl: string;
  projectDir: string;
  serverConfigPath: string;
  serverConfig: ServerConfig | null;
}

function getSettings(): Settings {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectDir = path.resolve(__dirname, "..");
  const serverConfigPath = path.join(projectDir, "server-config.json");

  const settings: Omit<Settings, "serverConfig"> & {
    serverConfig: ServerConfig | null;
  } = {
    model: "deepseek-chat",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: "https://api.deepseek.com",
    projectDir,
    serverConfigPath,
    serverConfig: null,
  };

  if (!settings.apiKey) {
    throw new Error(
      "DeepSeek API key is required. Please set DEEPSEEK_API_KEY in your .env file."
    );
  }

  try {
    const serverConfigRaw = fs.readFileSync(serverConfigPath, "utf-8");
    const config = JSON.parse(serverConfigRaw);

    const mcpServers = config.mcpServers;
    if (!mcpServers || Object.keys(mcpServers).length === 0) {
      throw new Error(
        "Config must contain at least one server in 'mcpServers'"
      );
    }

    const [name, server] = Object.entries(mcpServers)[0] as [
      string,
      { command: string; args: string[] }
    ];

    const requiredFields = ["command", "args"];
    const missingFields = requiredFields.filter((field) => !(field in server));
    if (missingFields.length > 0) {
      throw new Error(
        `Server '${name}' missing required fields: ${missingFields.join(", ")}`
      );
    }

    if (!Array.isArray(server.args) || server.args.length === 0) {
      throw new Error(`Server '${name}' must have a non-empty 'args' list`);
    }

    settings.serverConfig = {
      name,
      command: server.command,
      args: server.args,
    };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(`MCP Config file not found: ${serverConfigPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid MCP Config file: ${serverConfigPath}`);
    }
    throw error;
  }

  return settings as Settings;
}

const settings = getSettings();

export default settings;
