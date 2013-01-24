(function ($) {
    var currentHash = null;

    $.fn.hashchange = function (f) {
        $(window).bind('jQuery.hashchange', f);
        if (currentHash == null) {
            init();
        }
        return this;
    };

    $.fn.currenthash = function () {
        return currentHash;
    };

    $.fn.updatehash = function (newhash, extra) {
        triggerHash(newhash, extra);
        document.location.hash = '#' + newhash; // Should be last as execution of a function can halt here
        return this;
    };

    function isOnhashchangeSupported() {
        if (typeof window.onhashchange !== 'undefined') {
            if (document.documentMode && (document.documentMode < 8)) {
                // IE does not fire event in compatibility mode but it does define it
                return false;
            }
            return true;
        }
        else {
            return false;
        }
    }

    function triggerHash(newHash, extra) {
        if ((currentHash == null) || (currentHash != newHash)) {
            var oldHash = currentHash;
            currentHash = newHash;
            $(window).trigger('jQuery.hashchange', $.extend({}, extra || {}, {'currentHash': currentHash, 'oldHash': oldHash}));
        }
    }

    function callTriggerHash() {
        triggerHash(document.location.hash.replace(/^#/, ''));
    }

    function init() {
        if (isOnhashchangeSupported()) {
            window.addEventListener('hashchange', callTriggerHash);
        }
        else {
            setInterval(callTriggerHash, 200);
        }
        callTriggerHash();
    }
})(jQuery);
