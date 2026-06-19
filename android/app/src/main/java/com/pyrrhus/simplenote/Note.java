package com.pyrrhus.simplenote;

import org.json.JSONException;
import org.json.JSONObject;

final class Note {
    String id;
    String title;
    String content;
    String format;
    String category;
    String createdAt;
    String updatedAt;
    boolean deleted;

    JSONObject toJson() throws JSONException {
        return new JSONObject()
            .put("id", id)
            .put("title", title)
            .put("content", content)
            .put("format", format)
            .put("category", category)
            .put("created_at", createdAt)
            .put("updated_at", updatedAt)
            .put("deleted", deleted);
    }

    static Note fromJson(JSONObject object) {
        Note note = new Note();
        note.id = object.optString("id", java.util.UUID.randomUUID().toString());
        note.title = object.optString("title", "");
        note.content = object.optString("content", "");
        note.format = object.optString("format", "markdown");
        note.category = object.optString("category", "随笔");
        note.createdAt = object.optString("created_at", NoteDbHelper.now());
        note.updatedAt = object.optString("updated_at", note.createdAt);
        note.deleted = object.optBoolean("deleted", false);
        return note;
    }
}
