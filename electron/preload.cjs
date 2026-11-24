const { contextBridge, ipcRenderer } = require("electron");

const api = {
  set_ignore_mouse: (ignore) => ipcRenderer.invoke("island:set-ignore-mouse", ignore),
  set_position: (anchor, customX, customY) =>
    ipcRenderer.invoke("island:set-position", anchor, customX, customY),
  move_by: (dx, dy) => ipcRenderer.invoke("island:move-by", dx, dy),
  snap_current_position: () => ipcRenderer.invoke("island:snap-position"),
  pick_files_for_shelf: () => ipcRenderer.invoke("island:pick-files"),
  pick_folder_for_shortcut: () => ipcRenderer.invoke("island:pick-folder"),
  pick_cover_image: () => ipcRenderer.invoke("island:pick-cover-image"),
  pick_app_widget: () => ipcRenderer.invoke("island:pick-app"),
  list_installed_apps: () => ipcRenderer.invoke("island:list-installed-apps"),
  get_app_icon: (exePath) => ipcRenderer.invoke("island:get-app-icon", exePath),
  get_app_statuses: (names) => ipcRenderer.invoke("island:get-app-statuses", names),
  get_weather: (city) => ipcRenderer.invoke("island:get-weather", city),
  get_telemetry: () => ipcRenderer.invoke("island:get-telemetry"),
  get_now_playing: () => ipcRenderer.invoke("island:get-now-playing"),
  media_control: (action) => ipcRenderer.invoke("island:media-control", action),
  get_brightness: () => ipcRenderer.invoke("island:get-brightness"),
  set_brightness: (level) => ipcRenderer.invoke("island:set-brightness", level),
  get_clipboard: () => ipcRenderer.invoke("island:get-clipboard"),
  set_clipboard: (text) => ipcRenderer.invoke("island:set-clipboard", text),
  launch: (target) => ipcRenderer.invoke("island:launch", target),
  launch_and_paste: (target, promptText, appLabel) =>
    ipcRenderer.invoke("island:launch-and-paste", target, promptText, appLabel),
  play_media_query: (query, platform) =>
    ipcRenderer.invoke("island:play-media-query", query, platform),
  close_app: (name) => ipcRenderer.invoke("island:close-app", name),
  kb_load: () => ipcRenderer.invoke("island:kb-load"),
  kb_save: (data) => ipcRenderer.invoke("island:kb-save", data),
  system_action: (action) => ipcRenderer.invoke("island:system-action", action),
  nova_llm_route: (payload) => ipcRenderer.invoke("island:nova-llm-route", payload),
  open_project: (query) => ipcRenderer.invoke("island:open-project", query),
  find_projects: (query) => ipcRenderer.invoke("island:find-projects", query),
  open_path_in_code: (folderPath) => ipcRenderer.invoke("island:open-path-in-code", folderPath),
  voice_speak: (text, voice) => ipcRenderer.invoke("island:voice-speak", text, voice),
  voice_set_listen: (enabled) => ipcRenderer.invoke("island:voice-set-listen", enabled),
  voice_mute_for: (seconds) => ipcRenderer.invoke("island:voice-mute-for", seconds),
  on_voice_event: (cb) => {
    const fn = (_e, msg) => cb(msg);
    ipcRenderer.on("island:voice-event", fn);
    return () => ipcRenderer.removeListener("island:voice-event", fn);
  },
  load_config: () => ipcRenderer.invoke("island:load-config"),
  save_config: (data) => ipcRenderer.invoke("island:save-config", data),
  quit_app: () => ipcRenderer.invoke("island:quit"),
};

contextBridge.exposeInMainWorld("glassIsland", api);
