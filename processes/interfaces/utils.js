
var RESOURCE_NAMES_GROUP = "99  Hard Resources";
var HR_LISTS_DISPLAY_BASE = 20000;

// Display orders:
var global_display_order = 100;
module.exports.next_display_order = function(skip) {
    let rtn = global_display_order;
    global_display_order += skip || 1;
    return rtn;
};

module.exports.update_hard_resource_list_component = function(cascade, id, list, group) {
    // id is the name of the list and component
    // list is the current complete list of resource names
    var value = list.join(" ");
    var component = cascade.components.all_current[id];

    if (!component) {
        var type;
        if (value.length > 32) {
            type = cascade.TYPES.BIG_TEXT;
        }
        else {
            type = cascade.TYPES.TEXT;
        }

        cascade.create_component({
            id: id,
            group: group || RESOURCE_NAMES_GROUP,
            display_order: HR_LISTS_DISPLAY_BASE + module.exports.next_display_order(),
            read_only: true,
            type: type,
            value: value
        });
    }
    else {
        component.value = value;
    }
};