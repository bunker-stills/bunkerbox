var _ = require("underscore");

var read_topic_regex = new RegExp("^read\/([^\/]+)\/([^\/]+)\/([^\/]+)");
module.exports.parse_read_topic = function (topic) {
    var matches = read_topic_regex.exec(topic);

    if (_.isArray(matches) && matches.length >= 4) {
        return {
            group: matches[1],
            class: matches[2],
            component_id: matches[3]
        };
    }

    return null;
};

var write_topic_regex = new RegExp("^write\/([^\/]+)");
module.exports.parse_write_topic = function (topic) {
    var matches = write_topic_regex.exec(topic);

    if (_.isArray(matches) && matches.length >= 2) {
        return {
            component_id: matches[1]
        };
    }

    return null;
};