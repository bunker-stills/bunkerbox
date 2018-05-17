// Make sure all the NPM packages are installed
var child_process = require('child_process');
var path = require("path");

var bunkerboxDir = path.join(__dirname, "bunkerbox");

var result = child_process.spawnSync("git", ["status"], {
    cwd: bunkerboxDir
});
if(result.status !== 0)
{
    var gitREPO = process.env.BUNKERBOX_CODE_REPO || "https://github.com/bunker-stills/bunkerbox.git";
    console.log("Downloading Bunkerbox code from " + gitREPO + "...");

    // The bunkerbox directory doesn't exist, go ahead and get latest
    result = child_process.spawnSync("git", ["clone", gitREPO]);

    if(result.status !== 0)
    {
        console.error("Unable to download Bunkerbox code.");
        process.exit();
        return;
    }
}

// Get latest version
console.log("Pulling latest version...");
result = child_process.spawnSync("git", ["pull"], {
    cwd: bunkerboxDir
});

// Load dependencies
try
{
    var packageJSON = require(path.join(bunkerboxDir, "package.json"));
    for(var packageName in packageJSON.dependencies)
    {
        var package = require(path.join(bunkerboxDir, "node_modules", packageName));
    }
}
catch(e)
{
    console.log("Installing dependencies...");
    result = child_process.spawnSync("npm", ["install", "--production"], {
        cwd: bunkerboxDir
    });

    if(result.status !== 0)
    {
        console.error("Unable to install Bunkerbox dependencies.");
        process.exit();
        return;
    }

    console.log("Dependencies installed.");
}

// Start the bunker controller code
var bc = require(path.join(bunkerboxDir, "bunker_controller"));