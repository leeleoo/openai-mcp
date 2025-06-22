import OpenAI from "openai";
import readlineSync from "readline-sync";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import settings from "./settings.js";

import {
  ClientSession,
  StdioServerParameters,
  stdio_client,
} from "@modelcontextprotocol/sdk/dist/esm/client.js";
import {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/index.js";

const pino = require("pino");
const logger = pino();

class MCPClient {
  private session: ClientSession | null = null;
  private model: string;
  private openai: OpenAI;
  private serverConfig: { name: string; command: string; args: string[] };
  private messages: ChatCompletionMessageParam[] = [];

  constructor() {
    this.model = settings.model;
    this.openai = new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl,
    });
    this.serverConfig = settings.serverConfig!;
  }

  async connectToServer(): Promise<void> {
    console.log(
      chalk.greenBright("[HOST]"),
      `Connecting to server <${this.serverConfig.name}>...`
    );
    const serverParams = new StdioServerParameters({
      command: this.serverConfig.command,
      args: this.serverConfig.args,
    });
    const [stdio, write] = await stdio_client(serverParams);
    this.session = new ClientSession(stdio, write);
    await this.session.initialize();
    const response = await this.session.list_tools();
    const toolNames = response.tools.map((t) => chalk.green(t.name)).join(", ");
    console.log(
      chalk.greenBright("[HOST]"),
      `Connected with tools: ${toolNames}`
    );
  }

  async processQuery(query: string): Promise<string> {
    this.messages.push({ role: "user", content: query });

    const response = await this.session!.list_tools();
    const available_tools = response.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    const chatResponse = await this.openai.chat.completions.create({
      model: this.model,
      messages: this.messages,
      tools: available_tools.length > 0 ? available_tools : undefined,
      tool_choice: available_tools.length > 0 ? "auto" : undefined,
    });

    const content = chatResponse.choices[0];

    if (content.finish_reason === "tool_calls") {
      const tool_calls = content.message.tool_calls!;
      const tool_messages: ChatCompletionMessageParam[] = [];

      for (const tool_call of tool_calls) {
        const tool_name = tool_call.function.name;
        const tool_args = JSON.parse(tool_call.function.arguments);
        console.log(
          chalk.greenBright("[HOST]"),
          `Calling tool ${tool_name} with args ${JSON.stringify(tool_args)}`
        );
        const result = await this.session!.call_tool(tool_name, tool_args);
        tool_messages.push({
          role: "tool",
          content: result.content[0].text!,
          tool_call_id: tool_call.id,
        });
      }

      this.messages.push(content.message as ChatCompletionMessage);
      this.messages.push(...tool_messages);

      const second_response = await this.openai.chat.completions.create({
        model: this.model,
        messages: this.messages,
      });
      return second_response.choices[0].message.content!;
    }

    this.messages.push(content.message as ChatCompletionMessage);
    return content.message.content!;
  }

  async chatLoop(): Promise<void> {
    console.log(chalk.greenBright("[HOST]"), "MCP Client Started!");
    console.log(
      chalk.greenBright("[HOST]"),
      "Type your queries or 'quit' to exit."
    );

    while (true) {
      try {
        const query = readlineSync.question(chalk.cyanBright("[USER] ")).trim();
        if (query.toLowerCase() === "quit") {
          console.log(chalk.greenBright("[HOST]"), "Bye!");
          break;
        }

        process.stdout.write(chalk.blue("Thinking... "));
        const response = await this.processQuery(query);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        console.log(chalk.blueBright("[ASSISTANT]"), response);
      } catch (error: any) {
        logger.error(`Error: ${error.message}`);
      }
    }
  }

  async cleanup(): Promise<void> {
    const historyDir = path.join(settings.projectDir, "history");
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir);
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(historyDir, `${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.messages, null, 4));

    if (this.session) {
      await this.session.close();
    }
  }
}

async function main() {
  try {
    const client = new MCPClient();
    await client.connectToServer();
    await client.chatLoop();
    await client.cleanup();
  } catch (error: any) {
    logger.error(error.message);
  }
}

main();
