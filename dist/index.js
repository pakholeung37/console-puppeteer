"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_1 = __importDefault(require("puppeteer"));
const bluebird_1 = __importDefault(require("bluebird"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const process_1 = require("process");
const fs_1 = __importDefault(require("fs"));
const winston_1 = __importDefault(require("winston"));
const chalk_1 = __importDefault(require("chalk"));
dotenv_1.default.config();
// Setup winston logger
const logDirectory = "logs";
if (!fs_1.default.existsSync(logDirectory)) {
    fs_1.default.mkdirSync(logDirectory);
}
const currentDate = new Date();
const host = process.env.HOST || "localhost";
const subdomain = host.split(".")[0];
const name = subdomain.split("://")[1] || "app";
const teamId = process.env.TEAM_ID || "unknown";
const appId = process.env.APP_ID || "unknown";
const portalKey = process.env.PROTAL_KEY || "unknown";
let logFileName = `${currentDate.toISOString()}-${name}-${teamId}`;
if (process.argv.includes("--from")) {
    const from = process.argv[process.argv.indexOf("--from") + 1];
    if (from === "menu") {
        logFileName += `-portal${portalKey}`;
    }
    else if (from === "module") {
        logFileName += `-module${appId}`;
    }
}
logFileName += `.log`;
const logger = winston_1.default.createLogger({
    level: "info",
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} ${level}: ${message}`;
    })),
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message }) => {
                const ts = chalk_1.default.gray(`[${timestamp}]`);
                if (level === "error") {
                    return `${ts} ${chalk_1.default.red.bold("ERROR")} ${chalk_1.default.red(message)}`;
                }
                else {
                    return `${ts} ${chalk_1.default.green.bold("INFO")} ${chalk_1.default.white(message)}`;
                }
            })),
        }),
        new winston_1.default.transports.File({ filename: `${logDirectory}/${logFileName}` }),
    ],
});
// Custom log function to replace console.log
const log = {
    info: (message, ...args) => {
        const fullMessage = args.length > 0
            ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
            : message;
        logger.info(fullMessage);
    },
    error: (message, ...args) => {
        const fullMessage = args.length > 0
            ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
            : message;
        logger.error(fullMessage);
    },
    success: (message, ...args) => {
        const fullMessage = args.length > 0
            ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
            : message;
        logger.info(chalk_1.default.green.bold("✓ ") + fullMessage);
    },
    warning: (message, ...args) => {
        const fullMessage = args.length > 0
            ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
            : message;
        logger.info(chalk_1.default.yellow.bold("⚠ ") + fullMessage);
    },
    progress: (current, total, message = "") => {
        const percent = Math.floor((current / total) * 100);
        const progressBar = `[${chalk_1.default.cyan("=".repeat(Math.floor(percent / 5)))}${" ".repeat(20 - Math.floor(percent / 5))}] ${percent}%`;
        logger.info(`${progressBar} ${message} (${current}/${total})`);
    },
};
// read arg from command line like `node dist/index.js --parallel 4`
const args = process.argv.slice(2);
const url = process.env.HOST;
// params check
if (process.env.COOKIE_NAME === undefined ||
    process.env.COOKIE_VALUE === undefined ||
    process.env.COOKIE_DOMAIN === undefined) {
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
const request = axios_1.default.create({
    baseURL: url,
    headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
        cookie: process.env.COOKIE_NAME + "=" + process.env.COOKIE_VALUE,
    },
});
const queue = [];
let errorScenes = [];
async function getMenu() {
    const menu = await request.get(`/api/trantor/menu/tree/${process.env.PROTAL_KEY}`, {
        // params: {
        //   appId: process.env.PROTAL_KEY,
        //   teamId: process.env.TEAM_ID,
        // },
        headers: {
            "Trantor2-App": process.env.PROTAL_KEY,
            "Trantor2-Team": process.env.TEAM_ID,
            "Trantor2-Branch": process.env.BRANCH_ID,
        },
    });
    return menu.data.data;
}
/**
 * 从菜单中获取所有的场景
 * @param menu
 */
async function pushAllScenesFromMenu() {
    const pushAllScenesFromMenuInternal = (menu) => {
        for (const item of menu) {
            if (item.routeType === "Scene") {
                queue.push({
                    teamId: process.env.TEAM_ID,
                    // TODO wrong appId
                    appKey: undefined,
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
    const modules = await request.get(`/api/trantor/console/module/query?type=Module`, {
        headers: {
            "Trantor2-Team": process.env.TEAM_ID,
            "Trantor2-Branch": process.env.BRANCH_ID,
        },
    });
    return modules.data.data;
}
async function getScenesFromModule(moduleId) {
    try {
        const { data: resourcesTree } = await request.get(`/api/trantor/console/meta-data/resource-tree/folders?teamId=${process.env.TEAM_ID}&appId=${moduleId}&v2=true`, {
            headers: {
                "Trantor2-App": moduleId,
                "Trantor2-Team": process.env.TEAM_ID,
                "Trantor2-Branch": process.env.BRANCH_ID,
            },
        });
        // filter all the scenes
        const scenes = [];
        const findScenes = (resource) => {
            if (resource.type === "Scene") {
                scenes.push({
                    key: resource.key,
                    appKey: moduleId,
                    teamId: process.env.TEAM_ID,
                    // branchId: process.env.BRANCH_ID!,
                });
            }
            if (resource.children) {
                resource.children.forEach(findScenes);
            }
        };
        resourcesTree.data.forEach(findScenes);
        return scenes;
    }
    catch (e) {
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
    const scenes = await Promise.all(modules.map((module) => getScenesFromModule(module.key)));
    scenes.forEach((scene) => queue.push(...scene));
}
async function pushAllScenesFromModule(moduleId) {
    const scenes = await getScenesFromModule(moduleId);
    queue.push(...scenes);
}
async function replaceSceneKey(scenes) {
    scenes.forEach((scene) => {
        scene.appKey = scene.key.split("$")[0];
    });
}
async function processQueue(sceneMeta, index, browser) {
    const retries = 2;
    for (let i = 0; i < retries; i++) {
        const page = await browser.newPage();
        // set cookie
        await page.setCookie({
            name: process.env.COOKIE_NAME,
            value: process.env.COOKIE_VALUE,
            domain: process.env.COOKIE_DOMAIN,
        });
        const sceneUrl = `${url}/team/${sceneMeta.teamId}${process.env.BRANCH_ID ? `/branch/${process.env.BRANCH_ID}` : ""}/app/${sceneMeta.appKey}/scene/${sceneMeta.key}`;
        try {
            // unlock scene
            await request.post(`/api/trantor/console/dlock/unlock/${sceneMeta.key}`, {}, {
                headers: {
                    "Trantor2-App": sceneMeta.appKey,
                    "Trantor2-Team": process.env.TEAM_ID,
                    "Trantor2-Branch": process.env.BRANCH_ID,
                },
            });
            log.info("scene unlocked before open", sceneUrl);
            // validate the sceneMeta
            if (!sceneMeta.appKey || !sceneMeta.key) {
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
            const response = await page.waitForResponse((response) => response
                .url()
                .includes("/api/trantor/console/scenes/data-manager/update"));
            if (response.status() !== 200) {
                throw new Error("failed to save scene");
            }
            log.success("scene successfully saved", sceneUrl);
            log.progress(queue.length - index - 1, queue.length, "scenes processed");
            await page.close();
            break;
        }
        catch (e) {
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
            await request.post(`/api/trantor/console/dlock/unlock/${sceneMeta.key}`, {}, {
                headers: {
                    "Trantor2-App": sceneMeta.appKey,
                    "Trantor2-Team": process.env.TEAM_ID,
                    "Trantor2-Branch": process.env.BRANCH_ID,
                },
            });
            log.info("scene unlocked before close", sceneUrl);
        }
        catch (e) {
            log.error(e, "sceneUrl", sceneUrl);
        }
        log.warning("retrying scene", sceneUrl);
    }
}
(async function main() {
    // get all the scene page through api call
    if (from === "modules") {
        await pushAllScenesFromModules();
    }
    else if (from === "module") {
        if (process.env.APP_ID === undefined) {
            log.error("Please provide the portal key");
            process.exit(1);
        }
        await pushAllScenesFromModule(process.env.APP_ID);
    }
    else {
        if (process.env.PROTAL_KEY === undefined) {
            log.error("Please provide the portal key");
            process.exit(1);
        }
        await pushAllScenesFromMenu();
        await replaceSceneKey(queue);
    }
    log.info("all scenes: ", queue.length);
    const browser = await puppeteer_1.default.launch({
        headless,
        defaultViewport: null,
        args: ["--start-maximized"],
    });
    await bluebird_1.default.map(queue, (scene, index) => processQueue(scene, index, browser), {
        concurrency: parallel,
    });
    // 从新跑一遍失败的场景
    const errorScenesCopy = [...errorScenes];
    log.warning("retry error scenes", errorScenes);
    errorScenes = [];
    await bluebird_1.default.map(errorScenesCopy, (scene, index) => processQueue(scene, index, browser), {
        concurrency: parallel,
    });
    log.info("error scenes", errorScenes);
    log.info("error scenes count", errorScenes.length);
    await browser.close();
    if (errorScenes.length === 0) {
        log.success("All scenes are successfully saved");
        (0, process_1.exit)();
    }
    // write error scenes to log file
    const errorLogFileName = `${logDirectory}/errors-${logFileName}`;
    fs_1.default.writeFileSync(errorLogFileName, JSON.stringify(errorScenes, null, 2));
    (0, process_1.exit)();
})();
//# sourceMappingURL=index.js.map