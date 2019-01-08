var child_process = require('child_process');
var path = require("path");
var fs = require('fs');

var BB_APP_PROCESS = process.env.BB_APP_PROCESS || "processes/tf-redbrick";

var bunkerboxDir = process.cwd();
var result;

/*result = child_process.spawnSync("git", ["status"], {
    cwd: bunkerboxDir
});*/

/*if (result.status !== 0) {
    var gitREPO = process.env.BUNKERBOX_CODE_REPO || "https://github.com/bunker-stills/bunkerbox.git";
    console.log("Downloading Bunkerbox code from " + gitREPO + "...");

    // The bunkerbox directory doesn't exist, go ahead and get latest
    result = child_process.spawnSync("git", ["clone", gitREPO]);

    if (result.status !== 0) {
        console.error("Unable to download Bunkerbox code.");
        process.exit();
        return;
    }
}*/

// Get latest version
console.log("Pulling latest version...");
result = child_process.spawnSync("git", ["pull"], {
    cwd: bunkerboxDir
});

// Load dependencies
var needsUpdate = false;
var packageJSON = require(path.join(bunkerboxDir, "package.json"));

for (var packageName in packageJSON.dependencies) {
    if (!fs.existsSync(path.join(bunkerboxDir, "node_modules", packageName))) {
        needsUpdate = true;
        break;
    }
}

if(needsUpdate)
{
    console.log("Installing dependencies...");
    result = child_process.spawnSync("npm", ["install", "--production"], {
        cwd: bunkerboxDir
    });

    if (result.status !== 0) {
        console.error("Unable to install Bunkerbox dependencies.");
        process.exit();
        return;
    }
}

console.log("Dependencies installed.");

var BB_APP_PROCESS = process.env.BB_APP_PROCESS || "processes/tf-redbrick";

if (!process.env.CASCADE_PROCESSES) {
    process.env.CASCADE_PROCESSES = path.join(bunkerboxDir, "/" + BB_APP_PROCESS);
}

console.log("Starting BunkerBox...")

// Start the bunker controller code
var bc = require(path.join(bunkerboxDir, "bunker_controller"));