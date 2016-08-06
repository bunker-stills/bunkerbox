var mqtt_client;
var client_was_connected = false;
var components = {};

function initialize() {
    window.addEventListener("hashchange", function () {
        filter_for_group(get_current_group());
    }, false);
    display_login_screen();
}

/*var read_topic_regex = new RegExp("^read\/([^\/]+)\/([^\/]+)\/([^\/]+)");
parse_read_topic = function (topic) {
    var matches = read_topic_regex.exec(topic);

    if (_.isArray(matches) && matches.length >= 4) {
        return {
            group: matches[1],
            class: matches[2],
            component_id: matches[3]
        };
    }

    return null;
};*/

function disconnect_mqtt_client() {
    if (mqtt_client) {
        mqtt_client.end();
        mqtt_client = null;
    }
}

function connect_mqtt_client(username, password) {
    disconnect_mqtt_client();

    loading_indicator(true);

    mqtt_client = mqtt.connect(
        "ws://" + location.host,
        {
            username: username,
            password: password
        }
    );

    mqtt_client.on("error", function (error) {

        loading_indicator(false);

        if (error.message.indexOf("Not authorized") != -1) {
            disconnect_mqtt_client();
            display_login_screen();
        }
    });

    mqtt_client.on("connect", function () {
        client_was_connected = true;
        loading_indicator(false);
        dismiss_modal();

        // Get all the info for our components
        mqtt_client.subscribe("read/+/+/+/detail");
    });

    mqtt_client.on("close", function () {

        if (client_was_connected) {
            loading_indicator(true);
            display_modal_message("The server went offline. Trying to reconnect.", true);
        }

        client_was_connected = false;

        components = {};
        $("#groups").empty();
        $("#components").empty();
    });

    mqtt_client.on("message", function (topic, payload) {
        //var topic_info = parse_topic(topic);
        payload = JSON.parse(payload.toString());
        update_component_ui(payload);
    });
}

function display_login_screen() {
    loading_indicator(false);

    if ($.modal.isActive()) {
        $("#login-error").text("Invalid username or password.");
    }
    else {
        $("#login-modal").modal({
            escapeClose: false,
            clickClose: false,
            showClose: false
        });
    }
}

function process_login() {
    $("#login-error").text("");
    connect_mqtt_client($("#username-input").val(), $("#password-input").val());
}

function update_component_value(component) {
    var component_field = $("#component_field_" + component.id);

    if (component_field.length <= 0) {
        return; // This component doesn't exist
    }

    // Don't update the value if it's focused
    if (!component_field.is(":focus")) {

        switch (component.type) {
            case "OPTIONS" : {
                component_field.empty();

                component_field.append('<option value="">Select one...</option>');

                _.each(component.info.options, function (option) {

                    var option_field = $('<option></option>');
                    option_field.text(option);

                    if (component.value == option) {
                        option_field.prop("selected", true);
                    }

                    component_field.append(option_field);

                });

                break;
            }
            case "BOOLEAN" : {
                component_field.prop("checked", component.value);
                break;
            }
            default : {
                component_field.val(component.value);
            }
        }

        component_field.apply_animation("pulse");

        // Update our component info box if it's open
        var component_info = $("#component_info_" + component.id);
        if (component_info.length) {
            var component_info_code = component_info.find("pre code");
            var current_text = component_info_code.text();
            var new_text = get_raw_component_info_text(component);

            if (current_text != new_text) {
                component_info_code.text(new_text).apply_animation("pulse");
            }
        }
    }

}

function update_component_ui(component) {
    
    var component_row = $("#components .row[data-component='" + component.id + "']");
    var component_field = $("#component_field_" + component.id);
    var group_row = $("#groups .row[data-group='" + component.group + "']");

    // Create our group UI
    if (group_row.length == 0) {
        group_row = $('<div class="row"></div>')
            .attr("data-group", component.group);

        var column = $('<div class="12 columns"></div>');

        var link = $('<a class="group"></a>');
        link.attr("id", "group_" + component.group);
        link.attr("href", "#" + component.group);
        link.text(component.group);

        if(component.group === get_current_group())
        {
            link.addClass("active");
        }

        column.append(link);
        group_row.append(column);
        $("#groups").append(group_row);

        tinysort('#groups>row', '.group');
    }

    // Create our component UI
    if (component_row.length == 0) {
        component_row = $('<div class="row"><div class="twelve columns component"><label class="component_label"></label></div></div>')
            .attr("data-component", component.id)
            .attr("data-group", component.group);

        component_row.find("label.component_label").on("click", function () {
            toggle_component_info(component);
        });

        var value_column = component_row.find("div.component");

        switch (component.type) {
            case "OPTIONS" : {
                component_field = $('<select class="u-full-width"></select>')
                    .attr("id", "component_field_" + component.id);

                component_field.on("change", function () {
                    commit_edit_component(component_field);
                    component_field.blur();
                });

                value_column.append(component_field);

                break;
            }
            case "BOOLEAN" : {
                component_field = $('<input type="checkbox">');
                component_field.attr("id", "component_field_" + component.id);

                component_field.on("click", function () {
                    commit_edit_component(component_field);
                });

                $('<label class="switch"></label>').append(component_field).append($('<div class="slider round"></div>')).appendTo(value_column);
                break;
            }
            default: {
                component_field = $('<input class="u-full-width component_input" type="text">');
                component_field.attr("id", "component_field_" + component.id);
                component_field.focusin(begin_edit_component);
                value_column.append(component_field);

                var units = $('<span class="component_units"></span>');
                units.text(component.units);
                value_column.append(units);

                component_field.css("padding-right", units.width() + 15);
            }
        }

        if(component.group != get_current_group())
        {
            component_row.hide();
        }
        
        $("#components").append(component_row);

        tinysort('#components>row', 'label.component_label');
    }

    component_field.prop("disabled", component.read_only);
    component_field.data("details", component);

    component_row.find("label.component_label").text(component.name || component.id);

    update_component_value(component);
}

function filter_for_group(group_id) {
    $("#groups").find(".active").removeClass("active");
    $("#groups").find("#group_" + group_id).addClass("active");

    $("#components .row[data-group!='" + group_id + "']").hide();
    $("#components .row[data-group='" + group_id + "']").show();
}

function display_modal_message(message, prevent_close) {
    $("#message-modal").text(message).modal({
        escapeClose: !prevent_close,
        clickClose: !prevent_close,
        showClose: !prevent_close
    });
}

function dismiss_modal() {
    $.modal.close();
}

//////////////// OLD

function get_current_group() {
    return location.hash.replace(/^#/, "");
}

function end_edit_component() {
    $(".component_input").css("padding-left", "").unbind("keyup").unbind("blur");
    $("#component_editor").remove();
}

function commit_edit_component(component_element) {

    var component_data = component_element.data("details");

    var new_value;

    switch (component_element.attr("type")) {
        case "checkbox" : {
            new_value = component_element.prop("checked");
            break;
        }
        default: {
            new_value = component_element.val();
        }
    }

    component_element.unbind("blur");
    component_element.blur();
    end_edit_component();

    mqtt_client.publish("write/" + component_data.id, JSON.stringify(new_value), {
        qos : 2
    }, function () {
    });
}

function cancel_edit_component(component_element) {
    var component_data = component_element.data("details");

    component_element.val(component_data.value);

    end_edit_component();
}

function begin_edit_component(e) {
    var component_element = $(e.target);

    $("#component_editor").remove();

    var edit_div = $('<div id="component_editor"></div>');

    var accept_button = $('<button class="button-primary"><i class="fa fa-check"></i></button>');
    accept_button.on('mousedown', function (e) {
        commit_edit_component(component_element);
        e.preventDefault();
    });

    var cancel_button = $('<button class="button-primary cancel_button"><i class="fa fa-times"></i></button>');
    cancel_button.on('mousedown', function () {
        cancel_edit_component(component_element);
        e.preventDefault();
    });

    edit_div.append(accept_button);
    edit_div.append(cancel_button);

    component_element.before(edit_div);

    component_element.css("padding-left", edit_div.width() + 10);
    component_element.select();

    component_element.on("keyup", function (e) {
        if (e.keyCode == 27) // escape key
        {
            cancel_edit_component(component_element);
        }
        else if (e.keyCode == 13) // enter key
        {
            commit_edit_component(component_element);
        }
    });

    component_element.on("blur", function () {
        cancel_edit_component(component_element);
    });
}

function get_raw_component_info_text(component) {
    var output = JSON.stringify(component, null, 4);

    //output += "\r\n\r\nGET " + API_ROOT + "/groupes/" + current_group + "/" + component.id;
    //output += "\r\nPOST " + API_ROOT + "/groupes/" + current_group + "/" + component.id + "?value={some_value}";

    return output;
}

function toggle_component_info(component) {
    var component_detail_div = $("#component_info_" + component.id);

    if (component_detail_div.length) {
        return component_detail_div.remove();
    }

    component_detail_div = $('<div class="component_info"></div>');
    component_detail_div.attr("id", "component_info_" + component.id);

    var details = $('<pre><code>' + get_raw_component_info_text(component) + '</code></pre>');
    component_detail_div.append(details);

    $("#component_label_" + component.id).after(component_detail_div);
}

function loading_indicator(show) {
    $(".loading").toggleClass("fade-out", !show).toggleClass("fade-in", show);
}

$.fn.extend({
    apply_animation: function (class_name) {
        var animationEnd = 'webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend';
        $(this).addClass(class_name).one(animationEnd, function () {
            $(this).removeClass(class_name);
        });
    }
});

$(initialize);