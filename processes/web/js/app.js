function scrollPageRight()
{
    var pagePane = $("#page-pane");
    pagePane.scrollLeft(pagePane.scrollLeft() + 150);
    processPageScrollVisibility();
}

function scrollPageLeft()
{
    var pagePane = $("#page-pane");
    pagePane.scrollLeft(pagePane.scrollLeft() - 150);
    processPageScrollVisibility();
}

function processPageScrollVisibility()
{
    var pagePane = $("#page-pane");

    $("#prev-page-button").toggle(!(pagePane.scrollLeft() <= 0));
    $("#next-page-button").toggle(!(pagePane.scrollLeft() >= (pagePane[0].scrollWidth - pagePane.width())));
}

ko.bindingHandlers.autoSizeToText = {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
    },
    update : function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        var currentValue = ko.unwrap(valueAccessor()).toString();

        //$(element).css({"font-size":})
    }
};

ko.bindingHandlers.longClick = {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        var pressTimer;
        var fn = ko.unwrap(valueAccessor());

        function processFN()
        {
            fn.apply(bindingContext.$data);
        }

        $(element).on("mouseup mouseout touchend touchleave touchcancel", function(){
            clearTimeout(pressTimer);
            return false;
        }).on("mousedown touchstart", function(){

            processFN();

            pressTimer = setTimeout(function(){
                pressTimer = setInterval(processFN, 100);
            }, 1500);
            return false;
        });
    }
};

var modeModel = function(id, name)
{
    this.id = id;
    this.name = name;
    this.active = ko.observable(false);
};

var setPointModel = function(id, name, units, initialValue)
{
    var self = this;

    this.id = id;
    this.name = name;
    this.units = units;
    this.incrementAmount = 0.1;
    this.active = ko.observable(false);
    this.isEditing = ko.observable(false);
    this.template = "set-point-template";

    this.currentValue = ko.observable(initialValue || 0.0);
    this.displayValue = ko.observable(this.currentValue());

    this.increaseValue = function()
    {
        self.isEditing(true);

        var value = self.displayValue();
        value += self.incrementAmount;
        value = Number(value.toFixed(2));
        self.displayValue(value);
    };

    this.decreaseValue = function()
    {
        self.isEditing(true);

        var value = self.displayValue();
        value -= self.incrementAmount;
        value = Number(value.toFixed(2));
        self.displayValue(value);
    };

    this.commitValue = function()
    {
        self.isEditing(false);
        self.currentValue(self.displayValue());
    };

    this.cancelValue = function()
    {
        self.isEditing(false);
        self.displayValue(self.currentValue());
    };
};

var uiModel = function()
{
    var self = this;

    this.modes = ko.observableArray();
    this.pages = ko.observableArray();
    this.currentPage = ko.observable();

    this.addMode = function(id, name)
    {
        self.modes.push(new modeModel(id, name));
    };

    this.addPage = function(page)
    {
        self.pages.push(page);
    };

    this.pageClicked = function(page)
    {
        self.selectPageID(page.id);
    };

    this.selectPageID = function(id)
    {
        var pages = self.pages();

        for(var pageIndex in pages)
        {
            var page = pages[pageIndex];

            if(page.id === id)
            {
                page.active(true);
                self.currentPage(page);
            }
            else
            {
                page.active(false);
            }
        }
    };

    this.modeClicked = function(mode)
    {
        self.selectModeID(mode.id);
    };

    this.selectModeID = function(id)
    {
        var modes = self.modes();

        for(var modeIndex in modes)
        {
            var mode = modes[modeIndex];
            mode.active(mode.id === id);
        }
    }
};

var ui = new uiModel();

$(function(){

    ui.addMode("idle", "Idle");
    ui.addMode("warmup", "Warmup");

    ui.addPage(new setPointModel("pumpRate", "Pump Rate", "GPH", 999.99));

    ko.applyBindings(ui);
    processPageScrollVisibility();

    window.addEventListener('resize', processPageScrollVisibility, true);
});