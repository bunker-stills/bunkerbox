var _ = require("underscore");

module.exports.COMPONENT_BY_ID_BASE = COMPONENT_BY_ID_BASE = "component/by_id/";
module.exports.COMPONENT_BY_CLASS_BASE = COMPONENT_BY_CLASS_BASE = "component/by_class/";

var component_id_topic_regex = new RegExp("^" + COMPONENT_BY_ID_BASE + "([^\/]+)");
module.exports.get_component_id_from_topic = function(topic) {
    var matches = component_id_topic_regex.exec(topic);

    if (_.isArray(matches) && matches.length >= 2) {
        return matches[1];
    }

    return null;
};