import puppeteer, { Browser } from "puppeteer";
import bluebird from "bluebird";
import axios from "axios";
import dotenv from "dotenv";
import { exit } from "process";
import fs from "fs";
import winston from "winston";
import chalk from "chalk";

dotenv.config();

// Setup winston logger
const logDirectory = "logs";
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

const currentDate = new Date();
const host = process.env.HOST || "localhost";
const subdomain = host.split(".")[0];
const name = subdomain.split("://")[1] || "app";
const teamId = process.env.TEAM_ID || "unknown";
const appId = process.env.APP_ID || "unknown";
const portalId = process.env.PORTAL_ID || "unknown";

let logFileName = `${name}-${teamId}`;
if (process.argv.includes("--from")) {
  const from = process.argv[process.argv.indexOf("--from") + 1];
  if (from === "menu") {
    logFileName += `-portal${portalId}`;
  } else if (from === "module") {
    logFileName += `-module${appId}`;
  }
}
logFileName += `-${currentDate.toISOString()}.log`;

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          const ts = chalk.gray(`[${timestamp}]`);
          if (level === "error") {
            return `${ts} ${chalk.red.bold("ERROR")} ${chalk.red(message)}`;
          } else {
            return `${ts} ${chalk.green.bold("INFO")} ${chalk.white(message)}`;
          }
        })
      )
    }),
    new winston.transports.File({ filename: `${logDirectory}/${logFileName}` }),
  ],
});

// Custom log function to replace console.log
const log = {
  info: (message: string, ...args: any[]) => {
    const fullMessage =
      args.length > 0
        ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
        : message;
    logger.info(fullMessage);
  },
  error: (message: any, ...args: any[]) => {
    const fullMessage =
      args.length > 0
        ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
        : message;
    logger.error(fullMessage);
  },
  success: (message: string, ...args: any[]) => {
    const fullMessage =
      args.length > 0
        ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
        : message;
    logger.info(chalk.green.bold("✓ ") + fullMessage);
  },
  warning: (message: string, ...args: any[]) => {
    const fullMessage =
      args.length > 0
        ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
        : message;
    logger.info(chalk.yellow.bold("⚠ ") + fullMessage);
  },
  progress: (current: number, total: number, message: string = "") => {
    const percent = Math.floor((current / total) * 100);
    const progressBar = `[${chalk.cyan("=".repeat(Math.floor(percent / 5)))}${" ".repeat(20 - Math.floor(percent / 5))}] ${percent}%`;
    logger.info(`${progressBar} ${message} (${current}/${total})`);
  }
};

// read arg from command line like `node dist/index.js --parallel 4`
const args = process.argv.slice(2);
const url = process.env.HOST;
// params check
if (
  process.env.COOKIE_NAME === undefined ||
  process.env.COOKIE_VALUE === undefined ||
  process.env.COOKIE_DOMAIN === undefined
) {
  log.error("Please provide the cookie name, cookie value and cookie domain");
  process.exit(1);
}
if (url === undefined) {
  log.error("Please provide the console url");
  process.exit(1);
}
if (process.env.TEAM_ID === undefined) {
  log.error("Please provide the team id");
  process.exit(1);
}
// if (process.env.BRANCH_ID === undefined) {
//   log.error("Please provide the branch id");
//   process.exit(1);
// }

// default 4
const parallel = args.includes("--parallel")
  ? Number(args[args.indexOf("--parallel") + 1])
  : 4;

if (!url) {
  log.error("Please provide the console url");
  process.exit(1);
}

const from = args.includes("--from")
  ? args[args.indexOf("--from") + 1]
  : "menu";

const timeoutPerScene = args.includes("--timeout")
  ? Number(args[args.indexOf("--timeout") + 1])
  : 30 * 1000;

const headless = args.includes("--headless")
  ? args[args.indexOf("--headless") + 1] === "true"
  : true;

const request = axios.create({
  baseURL: url,
  headers: {
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
    cookie: process.env.COOKIE_NAME + "=" + process.env.COOKIE_VALUE,
  },
});

type ModuleMeta = {
  id: string;
  key: string;
  name: string;
  nativeModule: boolean;
  teamId: string;
  teamCode: string;
};

type ResourceMeta = {
  key: string;
  label: string;
  parentKey: string;
  type: string;
  children?: ResourceMeta[];
};

// shared scene page queue
type SceneMeta = {
  key: string;
  appId: string;
  teamId: string;
  url?: string;
  // branchId: string;
};

const queue: SceneMeta[] = [];

let errorScenes: SceneMeta[] = [];

type MenuItem = {
  routeType: "None" | "Scene";
  children: MenuItem[];
  routeConfig: {
    appId: string;
    sceneKey: string;
  };
};

async function getMenu() {
  const menu = await request.get<{ data: MenuItem[] }>(
    `/api/trantor/menu/tree/${process.env.PORTAL_ID}`,
    {
      // params: {
      //   appId: process.env.PORTAL_ID,
      //   teamId: process.env.TEAM_ID,
      // },
      headers: {
        "Trantor2-App": process.env.PORTAL_ID,
        "Trantor2-Team": process.env.TEAM_ID,
        "Trantor2-Branch": process.env.BRANCH_ID,
      },
    }
  );
  return menu.data.data;
}

/**
 * 从菜单中获取所有的场景
 * @param menu
 */
async function pushAllScenesFromMenu() {
  const pushAllScenesFromMenuInternal = (menu: MenuItem[]) => {
    for (const item of menu) {
      if (item.routeType === "Scene") {
        queue.push({
          teamId: process.env.TEAM_ID!,
          // TODO wrong appId
          appId: undefined as any,
          key: item.routeConfig.sceneKey,
        });
      }
      if (item.children?.length) {
        pushAllScenesFromMenuInternal(item.children);
      }
    }
  };
  const menu = await getMenu();
  pushAllScenesFromMenuInternal(menu);
  log.info("menu: ", menu.length);
}

/**
 *
 */
async function getModules() {
  const modules = await request.get<{ data: ModuleMeta[] }>(
    `/api/trantor/console/module/query?type=Module`,
    {
      headers: {
        "Trantor2-Team": process.env.TEAM_ID,
        "Trantor2-Branch": process.env.BRANCH_ID,
      },
    }
  );
  return modules.data.data;
}

async function getScenesFromModule(moduleId: string) {
  try {
    const { data: resourcesTree } = await request.get<{ data: ResourceMeta[] }>(
      `/api/trantor/console/meta-data/resource-tree/folders?teamId=${process.env.TEAM_ID}&appId=${moduleId}&v2=true`,
      {
        headers: {
          "Trantor2-App": moduleId,
          "Trantor2-Team": process.env.TEAM_ID,
          "Trantor2-Branch": process.env.BRANCH_ID,
        },
      }
    );
    // filter all the scenes
    const scenes = [] as SceneMeta[];
    const findScenes = (resource: ResourceMeta) => {
      if (resource.type === "Scene") {
        scenes.push({
          key: resource.key,
          appId: moduleId,
          teamId: process.env.TEAM_ID!,
          // branchId: process.env.BRANCH_ID!,
        });
      }
      if (resource.children) {
        resource.children.forEach(findScenes);
      }
    };
    resourcesTree.data.forEach(findScenes);
    return scenes;
  } catch (e) {
    log.error("failed to get scenes from module", moduleId);
    return [];
  }
}

/**
 * 从模块中获取所有的场景
 * @param modules
 */
async function pushAllScenesFromModules() {
  const modules = await getModules();
  const scenes = await Promise.all(
    modules.map((module) => getScenesFromModule(module.id))
  );
  scenes.forEach((scene) => queue.push(...scene));
}

async function pushAllScenesFromModule(moduleId: string) {
  const scenes = await getScenesFromModule(moduleId);
  queue.push(...scenes);
}

async function replaceSceneKey(scenes: SceneMeta[]) {
  const allSceneKeys = queue.map((scene) => scene.key);
  // request real appId
  const AppIds = await request.post<{
    data: { appId: string; metaKey: string }[];
  }>("/api/trantor/console/module/find-ids-by-meta-keys", allSceneKeys, {
    headers: {
      "Trantor2-App": process.env.PORTAL_ID,
      "Trantor2-Team": process.env.TEAM_ID,
      "Trantor2-Branch": process.env.BRANCH_ID,
    },
  });

  const sceneKeyAppIdMap = AppIds.data.data.reduce((acc, item) => {
    acc[item.metaKey] = item.appId;
    return acc;
  }, {} as Record<string, string>);

  scenes.forEach((scene) => {
    if (sceneKeyAppIdMap[scene.key]) {
      scene.appId = sceneKeyAppIdMap[scene.key];
    } else {
      log.error("appId not found for scene", scene.key, scene);
    }
  });
}

async function processQueue(
  sceneMeta: SceneMeta,
  index: number,
  browser: Browser
) {
  const retries = 2;
  for (let i = 0; i < retries; i++) {
    const page = await browser.newPage();
    // set cookie
    await page.setCookie({
      name: process.env.COOKIE_NAME!,
      value: process.env.COOKIE_VALUE!,
      domain: process.env.COOKIE_DOMAIN!,
    });
    const sceneUrl = `${url}/team/${sceneMeta.teamId}${
      process.env.BRANCH_ID ? `/branch/${process.env.BRANCH_ID}` : ""
    }/app/${sceneMeta.appId}/scene/${sceneMeta.key}`;
    try {
      // unlock scene
      await request.post(
        `/api/trantor/console/dlock/unlock/${sceneMeta.key}`,
        {},
        {
          headers: {
            "Trantor2-App": sceneMeta.appId,
            "Trantor2-Team": process.env.TEAM_ID,
            "Trantor2-Branch": process.env.BRANCH_ID,
          },
        }
      );
      log.info("scene unlocked before open", sceneUrl);
      // validate the sceneMeta
      if (!sceneMeta.appId || !sceneMeta.key) {
        log.error("invalid sceneMeta", sceneMeta);
        return;
      }

      log.info("opening scene", sceneUrl);
      await page.goto(sceneUrl);
      // wait for id=scene-save-button to be enabled

      await page.waitForSelector("#scene-save-button:enabled", {
        timeout: timeoutPerScene,
      });
      // click save button
      await page.click("#scene-save-button");
      // wait until update api finish
      const response = await page.waitForResponse((response) =>
        response
          .url()
          .includes("/api/trantor/console/scenes/data-manager/update")
      );
      if (response.status() !== 200) {
        throw new Error("failed to save scene");
      }

      log.success("scene successfully saved", sceneUrl);
      log.progress(queue.length - index - 1, queue.length, "scenes processed");
      await page.close();

      break;
    } catch (e) {
      log.error(e, "sceneUrl", sceneUrl);
      if (retries === i + 1) {
        errorScenes.push({
          ...sceneMeta,
          url: sceneUrl,
        });
      }
      await page.close();
    }
    // unlock the scene
    try {
      await request.post(
        `/api/trantor/console/dlock/unlock/${sceneMeta.key}`,
        {},
        {
          headers: {
            "Trantor2-App": sceneMeta.appId,
            "Trantor2-Team": process.env.TEAM_ID,
            "Trantor2-Branch": process.env.BRANCH_ID,
          },
        }
      );
      log.info("scene unlocked before close", sceneUrl);
    } catch (e) {
      log.error(e, "sceneUrl", sceneUrl);
    }
    log.warning("retrying scene", sceneUrl);
  }
}

(async function main() {
  // get all the scene page through api call
  if (from === "modules") {
    await pushAllScenesFromModules();
  } else if (from === "module") {
    if (process.env.APP_ID === undefined) {
      log.error("Please provide the portal id");
      process.exit(1);
    }
    await pushAllScenesFromModule(process.env.APP_ID);
  } else {
    if (process.env.PORTAL_ID === undefined) {
      log.error("Please provide the portal id");
      process.exit(1);
    }
    await pushAllScenesFromMenu();
    await replaceSceneKey(queue);
  }

  log.info("all scenes: ", queue.length);

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  await bluebird.map(
    queue,
    (scene, index) => processQueue(scene, index, browser),
    {
      concurrency: parallel,
    }
  );
  // 从新跑一遍失败的场景
  const errorScenesCopy = [...errorScenes];
  log.warning("retry error scenes", errorScenes);
  errorScenes = [];
  await bluebird.map(
    errorScenesCopy,
    (scene, index) => processQueue(scene, index, browser),
    {
      concurrency: parallel,
    }
  );

  log.info("error scenes", errorScenes);
  log.info("error scenes count", errorScenes.length);
  await browser.close();

  if (errorScenes.length === 0) {
    log.success("All scenes are successfully saved");
    exit();
  }
  // write error scenes to log file
  const errorLogFileName = `${logDirectory}/errors-${logFileName}`;
  fs.writeFileSync(errorLogFileName, JSON.stringify(errorScenes, null, 2));

  exit();
})();
