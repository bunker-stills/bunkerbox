var API_ROOT = location.origin + "/api";
var COMPONENT_BY_ID_BASE = "component/by_id/";

var mqtt_client;
var client_was_connected = false;
var components = {};

function initialize() {
    window.addEventListener("hashchange", function () {
        filter_for_process(get_location_hash());
    }, false);
    display_login_screen();
}

var component_id_topic_regex = new RegExp("^" + COMPONENT_BY_ID_BASE + "([^\/]+)");
function get_component_id_from_topic(topic) {
    var matches = component_id_topic_regex.exec(topic);

    if (_.isArray(matches) && matches.length >= 2) {
        return matches[1];
    }

    return null;
}

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
        mqtt_client.subscribe(COMPONENT_BY_ID_BASE + "#")
    });

    mqtt_client.on("close", function(){

        if(client_was_connected)
        {
            loading_indicator(true);
            display_modal_message("The server went offline. Trying to reconnect.", true);
        }

        client_was_connected = false;

        components = {};
        $("#processes").empty();
        $("#components").empty();
    });

    mqtt_client.on("message", function (topic, payload) {

        payload = payload.toString();

        if (/\/info$/.test(topic)) {
            var component = JSON.parse(payload);
            components[component.id] = component;

            create_process_ui(component.process_id);
            create_component_ui(component);
        }
        else // This is a value update
        {
            // Extract the component ID
            var component = components[get_component_id_from_topic(topic)];
            if (component) {
                component.value = payload;
                component.updated = (new Date()).toISOString();
                update_component_value(component);
            }
        }

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

function update_component_value(component)
{
    var component_field = $("#component_field_" + component.id);

    if (component_field.length <= 0) {
        return; // This component doesn't exist
    }

    // Don't update the value if it's focused
    if(!component_field.is(":focus")) {

        switch(component.type)
        {
            case "OPTIONS" :
            {
                component_field.empty();

                component_field.append('<option value="">Select one...</option>');

                _.each(component.info.options, function(option){

                    var option_field = $('<option></option>');
                    option_field.text(option);

                    if(component.value == option)
                    {
                        option_field.prop("selected", true);
                    }

                    component_field.append(option_field);

                });

                break;
            }
            case "BOOLEAN" :
            {
                component_field.prop("checked", component.value);
                break;
            }
            default :
            {
                component_field.val(component.value);
            }
        }

        component_field.apply_animation("pulse");

        // Update our component info box if it's open
        var component_info = $("#component_info_" + component.id);
        if(component_info.length)
        {
            var component_info_code = component_info.find("pre code");
            var current_text = component_info_code.text();
            var new_text = get_raw_component_info_text(component);

            if(current_text != new_text)
            {
                component_info_code.text(new_text).apply_animation("pulse");
            }
        }
    }

}

function create_component_ui(component) {
    var component_field = $("#component_field_" + component.id);

    if (component_field.length > 0) {
        return; // This component already exists in the UI
    }

    var row = $('<div class="row"></div>');
    row.attr("data-process-id", component.process_id);

    var value_column = $('<div class="twelve columns component"></div>');

    var name_label = $('<label class="component_label"></label>');
    name_label.attr("id", "component_label_" + component.id);
    name_label.text(component.name || component.id);

    name_label.on("click", function () {
        toggle_component_info(component);
    });

    value_column.append(name_label);

    switch (component.type) {
        case "OPTIONS" :
        {
            component_field = $('<select class="u-full-width"></select>');
            component_field.attr("id", "component_field_" + component.id);

            component_field.on("change", function () {
                commit_edit_component(component_field);
                component_field.blur();
            });

            value_column.append(component_field);

            break;
        }
        case "BOOLEAN" :
        {
            component_field = $('<input type="checkbox">');
            component_field.attr("id", "component_field_" + component.id);

            component_field.on("click", function () {
                commit_edit_component(component_field);
            });

            $('<label class="switch"></label>').append(component_field).append($('<div class="slider round"></div>')).appendTo(value_column);
            break;
        }
        default:
        {
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

    component_field.data("details", component);
    component_field.prop("disabled", component.read_only);

    row.append(value_column);
    $("#components").append(row);

    filter_for_process(get_location_hash());
}

function filter_for_process(process_id)
{
    $("#processes").find(".active").removeClass("active");
    $("#processes").find("#process_" + process_id).addClass("active");
    $("div[data-process-id!='" + process_id + "'][data-process-id]").hide();
    $("div[data-process-id='" + process_id + "'][data-process-id]").show();
}

function create_process_ui(process_id)
{
    if($("#process_" + process_id).length > 0)
    {
        return; // Process already exists
    }

    var process_element = $("#processes");

    var row = $('<div class="row"></div>');

    var column = $('<div class="12 columns"></div>');

    var link = $('<a class="process"></a>');
    link.attr("id", "process_" + process_id);
    link.attr("href", "#" + process_id);
    link.text(process_id);

    /*if(process_id === current_process)
    {
        link.addClass("active");
    }*/

    column.append(link);
    row.append(column);
    process_element.append(row);
}

function display_modal_message(message, prevent_close)
{
    $("#message-modal").text(message).modal({
        escapeClose: !prevent_close,
        clickClose: !prevent_close,
        showClose: !prevent_close
    });
}

function dismiss_modal()
{
    $.modal.close();
}

//////////////// OLD

function get_location_hash() {
    return location.hash.replace(/^#/, "");
}

function end_edit_component() {
    $(".component_input").css("padding-left", "").unbind("keyup").unbind("blur");
    $("#component_editor").remove();
}

/*function commit_edit_component(component_element) {

    var component_data = component_element.data("details");

    var new_value;

    switch (component_element.attr("type")) {
        case "checkbox" :
        {
            new_value = component_element.prop("checked");
            break;
        }
        default:
        {
            new_value = component_element.val();
        }
    }

    $.ajax({
        method: "post",
        dataType: "json",
        contentType: "application/json",
        url: API_ROOT + "/processes/" + current_process + "/" + component_data.id,
        data: JSON.stringify({
            value: new_value
        })
    }).done(function (data) {
        if (data) {
            component_data.value = data;
            component_element.data("details", component_data);
        }

        component_element.unbind("blur");
        component_element.blur();
        end_edit_component();
    });
}*/

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

    //output += "\r\n\r\nGET " + API_ROOT + "/processes/" + current_process + "/" + component.id;
    //output += "\r\nPOST " + API_ROOT + "/processes/" + current_process + "/" + component.id + "?value={some_value}";

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