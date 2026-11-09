import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

/// Base URL of the SecurePay API. Override at build time:
///   flutter run --dart-define=API_URL=http://10.0.2.2:4000/api/v1   (Android emulator)
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4000/api/v1');

class ApiException implements Exception {
  ApiException(this.status, this.message, {this.code, this.body});
  final int status;
  final String message;
  final String? code;
  final Map<String, dynamic>? body;

  bool get needsMfa => code == 'MFA_REQUIRED';

  @override
  String toString() => message;
}

/// HTTP client with token handling. The refresh token is kept in the platform keystore
/// (Keychain / Android Keystore); the access token lives only in memory.
class Api {
  Api._();
  static final Api instance = Api._();

  final _storage = const FlutterSecureStorage();
  final _uuid = const Uuid();
  String? _accessToken;
  Map<String, dynamic>? user;
  String? _deviceId;

  String newKey() => _uuid.v4();

  Future<String> deviceId() async {
    if (_deviceId != null) return _deviceId!;
    var id = await _storage.read(key: 'device_id');
    if (id == null) {
      id = _uuid.v4();
      await _storage.write(key: 'device_id', value: id);
    }
    return _deviceId = id;
  }

  Future<void> saveSession(Map<String, dynamic> tokens) async {
    _accessToken = tokens['accessToken'] as String;
    user = Map<String, dynamic>.from(tokens['user'] as Map);
    await _storage.write(key: 'refresh_token', value: tokens['refreshToken'] as String);
  }

  Future<void> clearSession() async {
    _accessToken = null;
    user = null;
    await _storage.delete(key: 'refresh_token');
  }

  Future<bool> restore() async {
    if (_accessToken != null) return true;
    return _refresh();
  }

  Future<bool> _refresh() async {
    final rt = await _storage.read(key: 'refresh_token');
    if (rt == null) return false;
    try {
      final res = await http.post(Uri.parse('$apiUrl/auth/refresh'),
          headers: {'content-type': 'application/json'}, body: jsonEncode({'refreshToken': rt}));
      if (res.statusCode != 200) {
        await clearSession();
        return false;
      }
      await saveSession(jsonDecode(res.body) as Map<String, dynamic>);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<dynamic> request(String path, {String method = 'GET', Object? body, bool auth = true}) async {
    if (auth && _accessToken == null) await _refresh();
    Future<http.Response> send() async {
      final headers = {
        'content-type': 'application/json',
        'x-device-id': await deviceId(),
        if (_accessToken != null) 'authorization': 'Bearer $_accessToken',
      };
      final uri = Uri.parse('$apiUrl$path');
      final encoded = body == null ? null : jsonEncode(body);
      switch (method) {
        case 'POST':
          return http.post(uri, headers: headers, body: encoded ?? '{}');
        case 'PATCH':
          return http.patch(uri, headers: headers, body: encoded);
        case 'DELETE':
          return http.delete(uri, headers: headers);
        default:
          return http.get(uri, headers: headers);
      }
    }

    http.Response res;
    try {
      res = await send();
      if (res.statusCode == 401 && auth && await _refresh()) res = await send();
    } catch (_) {
      throw ApiException(0, 'Cannot reach SecurePay. Check your connection.', code: 'NETWORK');
    }
    final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final map = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
      final msg = map['message'];
      throw ApiException(
        res.statusCode,
        msg is List ? msg.join('. ') : (msg?.toString() ?? 'Request failed (${res.statusCode})'),
        code: map['code'] as String?,
        body: map,
      );
    }
    return decoded;
  }

  Future<dynamic> get(String path) => request(path);
  Future<dynamic> post(String path, [Object? body]) => request(path, method: 'POST', body: body ?? {});

  Future<void> logout() async {
    final rt = await _storage.read(key: 'refresh_token');
    if (rt != null) {
      try {
        await request('/auth/logout', method: 'POST', body: {'refreshToken': rt}, auth: false);
      } catch (_) {}
    }
    await clearSession();
  }
}
