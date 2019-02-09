var _ = require("underscore");

function pid()
{
    this.Kp = 0;
    this.Ki = 0;
    this.Kd = 0;
    this.reset();
}
module.exports = pid;
pid.prototype.reset = function()
{
    this.lastMeasurementTime = 0;
    this.setPoint = 0;
    this.integral = 0;
    this.ki_previous = 0;
    // pid changes taken from Feedback Systems by Astrom adn Murray ch. 10
    // http://www.cds.caltech.edu/~murray/FBSwiki
    this.previousMeasured = 0;  // derivative based on measuredValue
    this.previousDerivative = 0;  // preserve for derivative filtering
    this.N = 8;  //derivative spike filter; larger N => less filtering; typ. val. 2-20
};

pid.prototype.setDesiredValue = function(setPoint)
{
    this.setPoint = setPoint;
};

pid.prototype.setProportionalGain = function(Kp)
{
    this.Kp = Kp;
};

pid.prototype.setIntegralGain = function(Ki)
{
    this.Ki = Ki;
};

pid.prototype.setDerivativeGain = function(Kd)
{
    this.Kd = Kd;
};

pid.prototype.update = function(measuredValue)
{
    var now = Date.now();
    var dt;

    if(!this.lastMeasurementTime)
    {
        dt = 1.0;
    }
    else
    {
        dt = (now - this.lastMeasurementTime) / 1000.0;
    }

    var input = measuredValue;
    var newIntegral = this.integral;

    var error = this.setPoint - input;

    // See: https://bunkerstills.slack.com/archives/D2UK88YJV/p1483845031000999 for reasons we have this this way
    newIntegral = newIntegral + (this.Ki * error * dt);

    var derivative = 0;
    if (this.Kd != 0) {
        //let denom = this.Kd + this.N * this.Kp * dt;
        //if (denom) {
        //    derivative = this.previousDerivative/denom - this.Kp * this.N *
        //        (input-this.previousMeasured)/denom;
        //}
        derivative = this.derivativeBeta * this.previousDerivative -
            (this.derivativeBeta -1) * (input-this.previousMeasured);
    }

    var CV = this.Kp * error + newIntegral + this.Kd * derivative;

    if(!_.isUndefined(this.CVUpperLimit) && CV >= this.CVUpperLimit)
    {
        // integral has the same sign sense as CV regarless of sign of Ki.
        if(newIntegral > this.integral)
        {
            // Stop integrating, reset the integral back to what it was before.
            newIntegral = this.integral;
        }

        CV = this.CVUpperLimit;
    }

    if(!_.isUndefined(this.CVLowerLimit) && CV <= this.CVLowerLimit)
    {
        // integral has the same sign sense as CV regarless of sign of Ki.
        if(newIntegral < this.integral)
        {
            // Stop integrating, reset the integral back to what it was before.
            newIntegral = this.integral;
        }

        CV = this.CVLowerLimit;
    }

    this.integral = newIntegral;
    this.previousMeasured = input;
    this.previousDerivative = derivative;
    this.lastMeasurementTime = now;

    return CV;
};

pid.prototype.setControlValueLimits = function(lowerLimit, upperLimit, offset)
{
    this.CVLowerLimit = lowerLimit;
    this.CVUpperLimit = upperLimit;
    this.CVOffset = offset;
};

pid.prototype.setDerivativeBeta = function(beta)
{
    this.derivativeBeta = Math.max(0, Math.min(1, beta));
};

pid.prototype.getIntegral = function()
{
    return this.integral;
};

pid.prototype.setIntegral = function(integral)
{
    this.integral = integral;
};

