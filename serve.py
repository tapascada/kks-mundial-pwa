import http.server
import socketserver
import mimetypes

# Fix Windows registry MIME type association bug for CSS and JS files
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('image/png', '.png')

PORT = 8080
Handler = http.server.SimpleHTTPRequestHandler

class MyHTTPRequestHandler(Handler):
    # Disable caching for local development
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

# Use ThreadingHTTPServer to handle multiple concurrent browser requests without blocking
with http.server.ThreadingHTTPServer(("", PORT), MyHTTPRequestHandler) as httpd:
    print(f"Serving at port {PORT}")
    httpd.serve_forever()
