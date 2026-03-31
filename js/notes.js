// Teleport RDP Web Player — Notes Module
// Stores per-recording notes in localStorage.

TPP.createNotes = function (rid) {
    var NOTES_KEY = 'tp_player_notes';

    function readAll() {
        try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function writeAll(data) {
        try { localStorage.setItem(NOTES_KEY, JSON.stringify(data)); }
        catch (e) { /* quota */ }
    }

    function get() {
        var all = readAll();
        return all[rid] || { tag: null, text: '' };
    }

    function save(note) {
        var all = readAll();
        all[rid] = note;
        writeAll(all);
    }

    function setTag(tag) {
        var note = get();
        note.tag = note.tag === tag ? null : tag; // Toggle
        save(note);
        return note;
    }

    function setText(text) {
        var note = get();
        note.text = text;
        save(note);
        return note;
    }

    return {
        get: get,
        save: save,
        setTag: setTag,
        setText: setText,
    };
};
