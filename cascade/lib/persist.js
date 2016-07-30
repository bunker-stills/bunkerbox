var _ = require("underscore");
var jsonfile = require('jsonfile');
var mkdir = require('mkdir-p');
var path = require("path");

var persist = function(config)
{
    _.defaults(config, {
        storage_path : process.cwd() + "/data.json"
    });

    this.config = config;
    this.settings = {};

    mkdir.sync(path.dirname(config.storage_path));

    try {
        this.settings = jsonfile.readFileSync(config.storage_path);
    }
    catch(e)
    {
    }
};

persist.prototype.get = function(name, default_value)
{
    return _.isUndefined(this.settings[name]) ? default_value : this.settings[name];
};

persist.prototype.set = function(name, value)
{
    this.settings[name] = value;
    this.save();
};

persist.prototype.save = function()
{
    jsonfile.writeFileSync(this.config.storage_path, this.settings, {spaces : 4});
};


module.exports = persist;