package com.briskemerald.briskdex;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveFilePickerPlugin.class);
        registerPlugin(BriskAppUpdaterPlugin.class);
        registerPlugin(BriskNativeGamePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
