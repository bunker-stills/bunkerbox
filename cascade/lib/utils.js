module.exports.is_numeric = function(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
};