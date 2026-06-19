package com.pyrrhus.simplenote;

import android.view.View;
import android.widget.AdapterView;

final class SimpleItemSelectedListener implements AdapterView.OnItemSelectedListener {
    private final Runnable action;
    SimpleItemSelectedListener(Runnable action) { this.action = action; }
    @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
        action.run();
    }
    @Override public void onNothingSelected(AdapterView<?> parent) {}
}
