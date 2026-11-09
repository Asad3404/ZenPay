import 'package:flutter/material.dart';

import '../api.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.onSignedIn});
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _code = TextEditingController();
  bool _register = false;
  bool _busy = false;
  String? _mfaToken;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = Api.instance;
    try {
      Map<String, dynamic> res;
      if (_mfaToken != null) {
        res = await api.request('/auth/mfa/verify', method: 'POST', auth: false, body: {'mfaToken': _mfaToken, 'code': _code.text});
      } else if (_register) {
        res = await api.request('/auth/register', method: 'POST', auth: false, body: {
          'email': _email.text.trim(),
          'password': _password.text,
          'fullName': _name.text.trim(),
        });
      } else {
        res = await api.request('/auth/login', method: 'POST', auth: false, body: {
          'email': _email.text.trim(),
          'password': _password.text,
          'deviceId': await api.deviceId(),
        });
        if (res['mfaRequired'] == true) {
          setState(() => _mfaToken = res['mfaToken'] as String);
          return;
        }
      }
      await api.saveSession(res);
      widget.onSignedIn();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: scheme.primary, borderRadius: BorderRadius.circular(10)),
                      child: Text('S', style: TextStyle(color: scheme.onPrimary, fontWeight: FontWeight.bold, fontSize: 20)),
                    ),
                    const SizedBox(width: 10),
                    const Text('SecurePay', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                  ]),
                  const SizedBox(height: 32),
                  Text(
                    _mfaToken != null ? 'Two-factor authentication' : (_register ? 'Create your wallet' : 'Welcome back'),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 20),
                  if (_mfaToken != null)
                    TextField(
                      controller: _code,
                      autofocus: true,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 22, letterSpacing: 8),
                      decoration: const InputDecoration(labelText: 'Authenticator code', counterText: ''),
                    )
                  else ...[
                    if (_register) ...[
                      TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name'), textCapitalization: TextCapitalization.words),
                      const SizedBox(height: 12),
                    ],
                    TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress, autocorrect: false),
                    const SizedBox(height: 12),
                    TextField(controller: _password, decoration: const InputDecoration(labelText: 'Password'), obscureText: true),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: TextStyle(color: scheme.error)),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    child: _busy
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(_mfaToken != null ? 'Verify' : (_register ? 'Create account' : 'Sign in')),
                  ),
                  const SizedBox(height: 8),
                  if (_mfaToken == null)
                    TextButton(
                      onPressed: () => setState(() => _register = !_register),
                      child: Text(_register ? 'Already have an account? Sign in' : 'New to SecurePay? Create an account'),
                    )
                  else
                    TextButton(onPressed: () => setState(() => _mfaToken = null), child: const Text('Back')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    for (final c in [_email, _password, _name, _code]) {
      c.dispose();
    }
    super.dispose();
  }
}

