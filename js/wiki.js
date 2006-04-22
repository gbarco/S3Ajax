/**
    S3AjaxWiki v0.1 - A client-side wiki for S3

    http://decafbad.com/trac/wiki/S3Ajax
    l.m.orchard@pobox.com
    Share and Enjoy.
*/

/*
// TODO: Find a way to minimize the number of JS includes on wiki pages.

function $import() {
    for (var i=0, path; path=arguments[i]; i++) {
        var script  = document.createElement('script');
        script.type = 'text/javascript';
        script.src  = path;
        document.getElementsByTagName('head')[0].appendChild(script);
    }
}

$import("js/firebug.js", "js/dojo.js", "js/sha1.js", "js/S3Ajax.js", 
          "js/wiky.js", "js/wiky.s3wiki.js");
*/

if (window.dojo) {
    dojo.require("dojo.storage.*");
}

S3AjaxWiki = {

    DEBUG:        true,

    BUCKET:       'decafbad',
    TEMPLATE_KEY: 'wiki-template.html',
    KEY_PREFIX:   'wiki/',
    DEFAULT_ACL:  'public-read',
    DEFAULT_TYPE: 'text/html',
    
    /*
        These are the IDs of elements injected as a part of the wiki
        editing framework, and should not end up in serialized pages.
    */
    INJECTED_IDS: [
        'content_edit', 'credentials', 'toc', 'page_options', 
        'xfer_msg', 'dojo-storeContainer'
    ],

    /**
        Initialize the wiki app
    */
    init: function() {
        // Debounce init calls.
        if (arguments.callee.done) return;
        arguments.callee.done = true;

        S3Ajax.DEBUG = this.DEBUG;
        S3Ajax.DEFEAT_CACHE = true;

        forEach([ 'FIELDSET', 'SCRIPT' ], function(n) { 
            window[n] = createDOMFunc(n); 
        });

        this.injectEditingFramework();
        this.autoLoadCredentials();
    },

    /**
        Try to load stored credentials when using dojo.storage.
        TODO: Scoop out dojo.storage to work separately from dojo proper.
    */
    autoLoadCredentials: function() {
        var _this = this;

        $('credentials_msg').innerHTML = 'No credentials.';
        this.hideCredentials();

        // HACK: Wait for the storage flash to become available.
        // TODO: Look for an official Dojo event to make this happen.
        this.hideCredentials();
        if (window.dojo) {
            this._storage_wait = setInterval(function() {
                if ($('dojo-storeContainer')) {
                    clearInterval(_this._storage_wait);
                    _this._storage_wait = null;
                    try {
                        _this.recall();
                    } catch(e) {
                    }
                }
            }, 100);
        } else {
            this.onLogin();
        }
    },

    /**
        Some things to perform upon (un)successful login.
    */
    onLogin: function() {
        this.scanWikiWords();
        this.refreshPageList();
    },

    /**
        Scan wiki word links on the page, with the intent to discover
        which actually exist.
    */
    scanWikiWords: function() {
        // Empty the list of words to scan
        this._scan_words = {};

        // Scan through wiki word links and gather unique list.
        var links = document.getElementsByTagName('a');
        for (var i=0, link; link=links[i]; i++) {
            if ('wikiword' == link.className) {
                this._scan_words[link.innerHTML] = true;
            }
        }

        // Collect a plain list of unique words.
        var words = [];
        for (var word in this._scan_words) { words.push(word); }
        this._doWordScan(words);
    },

    /**
        Perform S3 HEAD requests to determine the existence of a given
        list of wiki words.  Collect the results, make a note of which
        words exist or not.
    */
    _doWordScan: function(words) {
        var _this = this;
        
        // If the words list is empty, stop.
        if (!words.length) {
            return this.updateWikiWords();
        }

        // Search for existence of a word, marking it appropriately.
        var word = words.shift();
        S3Ajax.head(this.BUCKET, this.KEY_PREFIX + word,
            function() { 
                _this.markWikiWord(word, true);
                _this._doWordScan(words);
            },
            function() { 
                _this.markWikiWord(word, false);
                _this._doWordScan(words);
            }
        );
    },

    /**
        Mark a given wiki word as found, or not.
    */
    markWikiWord: function(word, found) {
        this._scan_words[word] = found;
        // HACK: Doing this for every found word might be too often.
        this.updateWikiWords();
    },

    /**
        Scan through wiki word links on the page.  For every link not
        found in S3, wire it up as a new page creation link.
    */
    updateWikiWords: function() {
        var links = document.getElementsByTagName('a');
        for (var i=0, link; link=links[i]; i++) {
            if ('wikiword' == link.className) {
                var word = link.innerHTML;
                if (!this._scan_words[word])
                    this.wireUpNewWord(link, word)
            }
        }
    },

    /**
        Wire up a wiki word link as a new page creation link, changing
        its CSS style and hooking its click event up to createNewPage().
    */
    wireUpNewWord: function(link, word) {
        var _this = this;
        link.className = 'newword';
        link.onclick = function() { 
            _this.createNewPage(word); return false; 
        }
    },
    
    /**
        For a given wiki word, create a new page.  Load up the wiki page
        template, change the header and body titles, save to S3 as a new
        key, redirect browser to the new page.

        TODO: Simply redirect if the page already exists?
    */
    createNewPage: function(word) {
        var _this = this;
        S3Ajax.get(_this.BUCKET, _this.TEMPLATE_KEY,
            function(req, data) {
                var xml = getResponseXML(req);

                // Update document head title
                var page_title = xml.getElementsByTagName('title')[0];
                page_title.firstChild.nodeValue = word;

                // Update page header title.
                /*
                // HACK: Should getElementById work here?  Seems not to.
                var head_title = xml.getElementById('page_title');
                head_title.nodeValue = word;
                */
                var h1s = xml.getElementsByTagName('h1');
                for (var i=0,h1; h1=h1s[i]; i++)
                    if ('page_title' == h1.getAttribute('id'))
                        h1.firstChild.nodeValue = word;

                // Get serialized HTML content from the page DOM
                var content = _this.fromDOMtoHTML(xml);

                // Upload to S3, redirect if successful.
                S3Ajax.put(_this.BUCKET, _this.KEY_PREFIX + word, content,
                    {
                        content_type: _this.DEFAULT_TYPE,
                        acl:          _this.DEFAULT_ACL,
                        meta:         {'posted-by':'S3AjaxWiki'}
                    },
                    function(req) {
                        location.href = word;
                    },
                    function(req, obj) {
                        $('xfer_msg').innerHTML = "Upload failed at "+(new Date());
                    }
                );
            },
            function(req, data) {
                // TODO: Do something useful on not finding the template.
                $('xfer_msg').innerHTML = "Template fetch failed at "+(new Date());
            }
        );
    },

    /**
        Refresh the list of available pages.
    */
    refreshPageList: function() {
        var _this = this;
        setList('page_list', ['Loading...','']);
        S3Ajax.listKeys(
            this.BUCKET, { prefix:this.KEY_PREFIX }, 
            function(req, obj) {
                clearList('page_list');
                var contents = obj.ListBucketResult.Contents;
                for (var i=0, item; item=contents[i]; i++) {
                    var key   = item.Key;
                    var title = key.substr(_this.KEY_PREFIX.length) 
                    addToList('page_list', title, key);
                }
            },
            function(req, obj) {
                setList('page_list', ['Failed to load list of pages.','']);
            }
        );


    },

    /**
        Navigate to a new wiki page.
    */
    selectPage: function(key) {
        var _this = this;

        if (!key) key = getSelected('page_list')[0];

        // Page title is key, sans prefix
        var title = (key.indexOf(_this.KEY_PREFIX) == 0) ?
            key.substr(_this.KEY_PREFIX.length) : key;

        location.href = title;

        /*
        $('page_title').innerHTML = title;

        $('content').innerHTML = "Loading...";

        S3Ajax.get(this.BUCKET, key,
            function(req, content) {
                $('content').innerHTML = content;
                $('editor').value = Wiky.toWiki(content);
            },
            function(req, objc) {
                $('content').innerHTML = "Download failed at "+(new Date());
                _this.showEditor();
                // TODO: Do something sensible here to create a new page?
            }
        );
        */

    },

    /**
    */
    editPage: function() {
        var content = $('content').innerHTML;
        $('editor').value = Wiky.toWiki(content);
        this.showEditor();
    },

    /**
    */
    cancelEdit: function() {
        this.hideEditor();
    },

    /**
    */
    previewPage: function() {
        var content = $('editor').value;
        $('content').innerHTML = Wiky.toHtml(content);
        this.scanWikiWords();
        this.hideEditor();
    },

    /**
    */
    updatePage: function(key) {
        var _this = this;
        if (!key) key = this.KEY_PREFIX + $('page_title').innerHTML;
        // if (!key) key = getSelected('page_list')[0];

        // Convert the wiki text to HTML and replace in page.
        $('content').innerHTML = Wiky.toHtml($('editor').value);
        this.hideEditor();

        // Get serialized HTML content from the page DOM
        var content = _this.fromDOMtoHTML();

        // Upload to S3, redirect if successful.
        S3Ajax.put(_this.BUCKET, key, content,
            {
                content_type: _this.DEFAULT_TYPE,
                acl:          _this.DEFAULT_ACL,
                meta:         {'posted-by':'S3AjaxWiki'}
            },
            function(req) {
                _this.scanWikiWords();
                $('xfer_msg').innerHTML = ""; // "Upload succeeded at "+(new Date()); 
            },
            function(req, obj) {
                $('xfer_msg').innerHTML = "Upload failed at "+(new Date());
            }
        );
    },

    /**
        Make an attempt to recall S3 credentials.
    */
    recall: function() {
        if (window.dojo) {
            if (dojo.storage && dojo.storage.get && dojo.storage.get('key_id', '/S3Ajax')) {
                S3Ajax.KEY_ID     = dojo.storage.get('key_id',     '/S3Ajax');
                S3Ajax.SECRET_KEY = dojo.storage.get('secret_key', '/S3Ajax');
                $('key_id').value = S3Ajax.KEY_ID;
                $('credentials_msg').innerHTML = 'Credentials restored.';
                this.hideCredentials();
                this.onLogin();
            }
        }
    },

    /**
        Accept new credentials from the form in the page.
    */
    login: function() {
        S3Ajax.KEY_ID     = $('key_id').value;
        S3Ajax.SECRET_KEY = $('secret_key').value;

        // Try to stash the credentials away for next time.
        if (window.dojo) {
            dojo.storage.set('key_id',     S3Ajax.KEY_ID,     '/S3Ajax');
            dojo.storage.set('secret_key', S3Ajax.SECRET_KEY, '/S3Ajax');
        }

        $('credentials_msg').innerHTML = 'Credentials supplied.';
        this.hideCredentials();
        this.onLogin();
    },

    showEditor: function() {
        $('content_edit').style.display = "block";
        $('content').style.display = "none";
    },

    hideEditor: function() {
        $('content_edit').style.display = "none";
        $('content').style.display = "";
    },

    showCredentials: function() {
        $('credentials_fields').style.display = "block";
    },

    hideCredentials: function() {
        $('credentials_fields').style.display = "none";
    },

    /**
        Serialize a given DOM to HTML source.  If no node given, assume 
        the current page should be serialized.  Note that this makes efforts
        using INJECTED_IDS to avoid including the injected editor framework.
    */
    fromDOMtoHTML: function(node) {

        if (!node) node = document;

        switch (node.nodeType) {

            case Node.DOCUMENT_NODE:
                // HACK: Look for the first <html> in a document node.
                return this.fromDOMtoHTML(node.getElementsByTagName('html')[0]);

            case Node.TEXT_NODE:
                return node.nodeValue;

            case Node.ELEMENT_NODE:
                var node_name = node.nodeName.toLowerCase();

                // Start serializing the current node.
                var out = '<' + node_name;

                // Serialize the attributes of the node.
                for (var i=0, attr; attr=node.attributes[i]; i++) {
                    var name  = attr.name;
                    var value = attr.value;
                    if (value) out += ' '+name+'="'+value+'"';
                }

                // Serialize all child nodes found.
                var sub_out = '';
                for (var i=0, child; child=node.childNodes[i]; i++) {
                    
                    // Do not serialize nodes injected by editor.
                    var skip = false;
                    for (var j=0, skip_id; skip_id=this.INJECTED_IDS[j]; j++) {
                        if (skip_id == child.id) { skip=true; break; }
                    }

                    // Serialize the child node if not skipping.
                    if (!skip) sub_out += this.fromDOMtoHTML(child);
                
                }

                // Finalize the current node.
                // HACK: Script tags cannot be empty, for MSIE
                if (sub_out || 'script'==node_name)
                    return out + '>' + sub_out + '</' + node_name + '>';
                else 
                    return out + '/>';

            default:
                return '';
        }
    
    },

    /**
        Build and inject the DOM structures necessary for editing 
        wiki pages.  The events wired up are a little bit of a hack.
    */
    injectEditingFramework: function() {

        var body = document.getElementsByTagName('body')[0];

        appendChildNodes(body, [

            // Build the content editing form.
            FORM({"id":"content_edit", "onsubmit":"return false"},
                TEXTAREA({"id":"editor", "name":"editor", "cols":"80", "rows":"30"}),
                BR(),
                FIELDSET({},
                    BUTTON({"id":"preview", "onclick":"S3AjaxWiki.previewPage(); return false"}, "Preview Changes"),
                    BUTTON({"id":"submit",  "onclick":"S3AjaxWiki.updatePage();  return false"}, "Submit Changes"),
                    BUTTON({"id":"cancel",  "onclick":"S3AjaxWiki.cancelEdit();  return false"}, "Cancel")
                )
            ),

            // Build the login credentials form.
            FORM({"id":"credentials", "onsubmit":"S3AjaxWiki.login(); return false;"}, 
                DIV({"id":"cals_status"}, 
                    SPAN({"id":"credentials_msg"}),
                    " ",
                    A({"href":"#", "onclick":"S3AjaxWiki.showCredentials(); return false"}, "Login.")
                ),
                FIELDSET({"id":"credentials_fields"}, 

                    LEGEND({}, "Credentials"),

                    LABEL({"for":"key_id"}, "AWSAccessKey"), BR(),
                    INPUT({"type":"text", "size":"25", "id":"key_id", "name":"key_id"}), BR(),
                    
                    LABEL({"for":"secret_key"}, "SecretAccessKey"), BR(),
                    INPUT({"type":"password", "size":"25", "id":"secret_key", "name":"secret_key"}), BR(),

                    BUTTON({"id":"store", "onclick":"S3AjaxWiki.login(); return false"}, " Store "),
                    BUTTON({"id":"recall", "onclick":"S3AjaxWiki.recall(); return false"}, " Recall "),
                    BUTTON({"id":"cancel", "onclick":"S3AjaxWiki.hideCredentials(); return false"}, " Cancel ")
                )
            ),

            // Build the page list box.
            FORM({'id':'toc', 'onsubmit':'return false'},
                SELECT({'id':'page_list', 'name':'page_list', 'onchange':'S3AjaxWiki.selectPage(); return false'}),
                BUTTON({'id':'list_pages', 'onclick':'S3AjaxWiki.refreshPageList(); return false'}, 'Refresh' ),
                BUTTON({'id':'get_pages',  'onclick':'S3AjaxWiki.selectPage(); return false'}, 'Get' )
            ),

            // Set up the page options div
            FORM({'id':'page_options', 'onsubmit':'return false'},
                BUTTON({'onclick':'S3AjaxWiki.editPage(); return false;'}, "Edit this Page"),
                " | ",
                INPUT({'type':'text', 'size':'15', 'id':'new_page_name', 'name':'new_page_name'}),
                BUTTON({'onclick':'S3AjaxWiki.createNewPage($("new_page_name").value); return false;'}, "Create New Page")
            ),

            // Inject the xfer message div.
            SPAN({'id':'xfer_msg'})

        ]);

    },

    /* Help protect against errant end-commas */
    EOF: null
};

/**
    Schedule the whole mess to fire up on load.
*/
addLoadEvent(function(){ S3AjaxWiki.init() });
