import http.server
import socketserver
import ssl
import os

PORT = 8080
DIRECTORY = os.getcwd()

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

httpd = socketserver.TCPServer(("0.0.0.0", PORT), Handler)

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('server.pem')

httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
print(f"Serving HTTPS on 0.0.0.0 port {PORT} (https://0.0.0.0:{PORT}/) ...")
httpd.serve_forever() 