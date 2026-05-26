use std::net::TcpListener;
use std::io::{Read, Write};
use std::time::Duration;
use rusqlite::{params, Connection};
use tauri::Manager;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct LocalNote {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "contentMd")]
    pub content_md: String,
    pub pinned: bool,
    pub created: i64,
    pub updated: i64,
    pub synced: bool,
    pub remote: bool,
}

fn get_connection(app_handle: &tauri::AppHandle) -> Result<Connection, String> {
    let data_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let db_path = data_dir.join("zenwii.db");
    Connection::open(db_path).map_err(|e| e.to_string())
}

fn init_db(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let conn = get_connection(app_handle)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notas (
            id TEXT PRIMARY KEY,
            title TEXT,
            content TEXT,
            content_md TEXT,
            pinned INTEGER,
            created INTEGER,
            updated INTEGER,
            synced INTEGER,
            remote INTEGER
        )",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn db_load_notes(app_handle: tauri::AppHandle) -> Result<Vec<LocalNote>, String> {
    let conn = get_connection(&app_handle)?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, content_md, pinned, created, updated, synced, remote FROM notas")
        .map_err(|e| e.to_string())?;
    
    let note_iter = stmt
        .query_map([], |row| {
            Ok(LocalNote {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                content_md: row.get(3)?,
                pinned: row.get::<_, i32>(4)? != 0,
                created: row.get(5)?,
                updated: row.get(6)?,
                synced: row.get::<_, i32>(7)? != 0,
                remote: row.get::<_, i32>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
        
    let mut notes = Vec::new();
    for note in note_iter {
        notes.push(note.map_err(|e| e.to_string())?);
    }
    
    Ok(notes)
}

#[tauri::command]
async fn db_save_note(app_handle: tauri::AppHandle, note: LocalNote) -> Result<(), String> {
    let conn = get_connection(&app_handle)?;
    conn.execute(
        "INSERT OR REPLACE INTO notas (id, title, content, content_md, pinned, created, updated, synced, remote)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            note.id,
            note.title,
            note.content,
            note.content_md,
            if note.pinned { 1 } else { 0 },
            note.created,
            note.updated,
            if note.synced { 1 } else { 0 },
            if note.remote { 1 } else { 0 },
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn db_delete_note(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app_handle)?;
    conn.execute("DELETE FROM notas WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start_auth_server() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind("127.0.0.1:1425").map_err(|e| e.to_string())?;
        
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                    
                    let mut request_data = Vec::new();
                    let mut buffer = [0; 2048];
                    let mut found_headers = false;
                    
                    while request_data.len() < 16384 {
                        match stream.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(n) => {
                                request_data.extend_from_slice(&buffer[..n]);
                                if let Ok(req_str) = std::str::from_utf8(&request_data) {
                                    if req_str.contains("\r\n\r\n") || req_str.contains("\n\n") {
                                        found_headers = true;
                                        break;
                                    }
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    
                    if !found_headers {
                        continue;
                    }
                    
                    let request = String::from_utf8_lossy(&request_data);
                    
                    let mut id_token = String::new();
                    let mut access_token = String::new();
                    
                    if let Some(start_pos) = request.find("GET /") {
                        let subset = &request[start_pos + 5..];
                        if let Some(end_pos) = subset.find(" HTTP/") {
                            let path_and_query = &subset[..end_pos];
                            if let Some(q_pos) = path_and_query.find('?') {
                                let query = &path_and_query[q_pos + 1..];
                                for part in query.split('&') {
                                    let key_val: Vec<&str> = part.split('=').collect();
                                    if key_val.len() == 2 {
                                        if key_val[0] == "idToken" {
                                            id_token = key_val[1].to_string();
                                        } else if key_val[0] == "accessToken" {
                                            access_token = key_val[1].to_string();
                                        }
                                    }
                                }
                            }
                        }
                    }
                        
                        if !id_token.is_empty() {
                            let response = "HTTP/1.1 302 Found\r\n\
                                            Location: https://zenwii.web.app/\r\n\
                                            Content-Length: 0\r\n\
                                            Cache-Control: no-store, no-cache, must-revalidate\r\n\
                                            Pragma: no-cache\r\n\
                                            Connection: close\r\n\r\n";
                            
                            let _ = stream.write_all(response.as_bytes());
                            let _ = stream.flush();
                            
                            let _ = stream.shutdown(std::net::Shutdown::Write);
                            let mut discard_buf = [0; 512];
                            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                            while let Ok(n) = stream.read(&mut discard_buf) {
                                if n == 0 {
                                    break;
                                }
                            }
                            
                            return Ok(serde_json::json!({
                                "idToken": id_token,
                                "accessToken": access_token
                            }));
                        }
                    
                    let response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                }
                Err(_) => {}
            }
        }
        Err("Servidor cerrado sin recibir credenciales.".to_string())
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_auth_server,
            db_load_notes,
            db_save_note,
            db_delete_note
        ])
        .setup(|app| {
            if let Err(e) = init_db(app.handle()) {
                eprintln!("Error al inicializar SQLite: {}", e);
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let size = monitor.size();
                    let scale_factor = monitor.scale_factor();
                    
                    // Margen y altura personalizados (90% de alto con 20px de margen a la derecha)
                    let logical_width = 500.0;
                    let logical_gap = 10.0;
                    
                    let physical_width = (logical_width * scale_factor) as u32;
                    let physical_gap = (logical_gap * scale_factor) as i32;
                    
                    // 90% de la altura total física de la pantalla
                    let physical_height = ((size.height as f64) * 0.92) as u32;
                    
                    // Colocar en el extremo derecho menos el margen
                    let x = (size.width as i32) - (physical_width as i32) - physical_gap;
                    
                    // Alinear al tope superior (y = 0) para evitar que la barra de tareas de Windows tape el pie de página
                    let y = 0;
                    
                    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(physical_width, physical_height)));
                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
