"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * trantor console page saver, this script will open all page of the given console url and open the page, click the 'save' button and re-save the page.
 * 1. create a cluster of workers
 * 2. open the console page
 * 3. get all the scene page through api call
 * 4. add all the scene page url to the queue
 * 5. workers will pick the scene page from the queue and open the page and save the page
 * 6. workers will open the page and wait for the page to load. as soon as the save button is enabled, click the save button and re-save the page.
 */
const puppeteer_1 = __importDefault(require("puppeteer"));
const bluebird_1 = __importDefault(require("bluebird"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const process_1 = require("process");
dotenv_1.default.config();
// read arg from command line like `node dist/index.js --parallel 4`
const args = process.argv.slice(2);
const url = process.env.HOST;
// params check
if (process.env.COOKIE_NAME === undefined ||
    process.env.COOKIE_VALUE === undefined ||
    process.env.COOKIE_DOMAIN === undefined) {
    console.error("Please provide the cookie name, cookie value and cookie domain");
    process.exit(1);
}
if (url === undefined) {
    console.error("Please provide the console url");
    process.exit(1);
}
if (process.env.TEAM_ID === undefined) {
    console.error("Please provide the team id");
    process.exit(1);
}
if (process.env.BRANCH_ID === undefined) {
    console.error("Please provide the branch id");
    process.exit(1);
}
if (process.env.PORTAL_ID === undefined) {
    console.error("Please provide the portal id");
    process.exit(1);
}
// default 4
const parallel = args.includes("--parallel")
    ? Number(args[args.indexOf("--parallel") + 1])
    : 4;
if (!url) {
    console.error("Please provide the console url");
    process.exit(1);
}
const request = axios_1.default.create({
    baseURL: url,
    headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
        cookie: process.env.COOKIE_NAME + "=" + process.env.COOKIE_VALUE,
    },
});
const queue = [];
(async () => {
    // get all the scene page through api call
    const menu = await getMenu();
    console.log("menu: ", menu.length);
    pushAllScenesFromMenu(menu);
    await replaceSceneKey(queue);
    console.log("all scenes: ", queue.length);
    const browser = await puppeteer_1.default.launch({
        headless: true,
        defaultViewport: null,
        args: ["--start-maximized"],
    });
    await bluebird_1.default.map(queue, (scene, index) => processQueue(scene, index, browser), {
        concurrency: parallel,
    });
    (0, process_1.exit)();
})();
async function getMenu() {
    const menu = await request.get(`/api/trantor/menu/${process.env.PORTAL_ID}`, {
        params: {
            appId: process.env.PORTAL_ID,
            teamId: process.env.TEAM_ID,
        },
        headers: {
            "Trantor2-App": process.env.PORTAL_ID,
            "Trantor2-Team": process.env.TEAM_ID,
            "Trantor2-Branch": process.env.BRANCH_ID,
        },
    });
    return menu.data.data;
}
function pushAllScenesFromMenu(menu) {
    for (const item of menu) {
        if (item.routeType === "Scene") {
            queue.push({
                teamId: process.env.TEAM_ID,
                // TODO wrong appId
                appId: undefined,
                branchId: process.env.BRANCH_ID,
                key: item.routeConfig.sceneKey,
            });
        }
        if (item.children?.length) {
            pushAllScenesFromMenu(item.children);
        }
    }
}
async function replaceSceneKey(scenes) {
    const allSceneKeys = queue.map((scene) => scene.key);
    // request real appId
    const AppIds = await request.post("/api/trantor/console/module/find-ids-by-meta-keys", allSceneKeys, {
        headers: {
            "Trantor2-App": process.env.PORTAL_ID,
            "Trantor2-Team": process.env.TEAM_ID,
            "Trantor2-Branch": process.env.BRANCH_ID,
        },
    });
    const sceneKeyAppIdMap = AppIds.data.data.reduce((acc, item) => {
        acc[item.metaKey] = item.appId;
        return acc;
    }, {});
    scenes.forEach((scene) => {
        if (sceneKeyAppIdMap[scene.key]) {
            scene.appId = sceneKeyAppIdMap[scene.key];
        }
        else {
            console.error("appId not found for scene", scene.key, scene);
        }
    });
}
async function processQueue(sceneMeta, index, browser) {
    const retries = 3;
    for (let i = 0; i < retries; i++) {
        const page = await browser.newPage();
        // set cookie
        await page.setCookie({
            name: process.env.COOKIE_NAME,
            value: process.env.COOKIE_VALUE,
            domain: process.env.COOKIE_DOMAIN,
        });
        // validate the sceneMeta
        if (!sceneMeta.appId || !sceneMeta.branchId || !sceneMeta.key) {
            console.error("invalid sceneMeta", sceneMeta);
            return;
        }
        const sceneUrl = `${url}/team/${sceneMeta.teamId}/branch/${sceneMeta.branchId}/app/${sceneMeta.appId}/scene/${sceneMeta.key}`;
        console.log("opening scene", sceneUrl);
        await page.goto(sceneUrl);
        try {
            // 30s timeout, if the page is not loaded in 30s, it will throw error
            const timeout = 10 * 1000;
            // wait for id=scene-save-button to be enabled
            await page.waitForSelector("#scene-save-button:enabled", { timeout });
            // click save button
            await page.click("#scene-save-button");
            // wait for button to be not .ant-btn-loading
            await page.waitForSelector("#scene-unlock-button", {
                timeout,
            });
            console.log("scene successfully saved", sceneUrl);
            console.log("scenes index: ", index);
            await page.close();
            // unlock the scene
            await request.post(`/api/trantor/console/dlock/unlock/${sceneMeta.key}`, {}, {
                headers: {
                    "Trantor2-App": sceneMeta.appId,
                    "Trantor2-Team": sceneMeta.teamId,
                    "Trantor2-Branch": sceneMeta.branchId,
                },
            });
            console.log("scene unlocked", sceneMeta.key);
            break;
        }
        catch (e) {
            console.error(e, sceneMeta.key, sceneMeta);
            await page.close();
        }
        console.log("retrying scene", sceneMeta.key);
    }
}
//# sourceMappingURL=index.js.map