import 'package:flutter/material.dart';

import 'api.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SecurePayApp());
}

class SecurePayApp extends StatelessWidget {
  const SecurePayApp({super.key});

  static const brand = Color(0xFF0F766E);

  @override
  Widget build(BuildContext context) {
    ThemeData theme(Brightness b) => ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: brand, brightness: b),
          inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
        );
    return MaterialApp(
      title: 'SecurePay',
      debugShowCheckedModeBanner: false,
      theme: theme(Brightness.light),
      darkTheme: theme(Brightness.dark),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool? _signedIn;

  @override
  void initState() {
    super.initState();
    Api.instance.restore().then((ok) {
      if (mounted) setState(() => _signedIn = ok && Api.instance.user != null);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_signedIn == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return _signedIn!
        ? HomeScreen(onLogout: () => setState(() => _signedIn = false))
        : LoginScreen(onSignedIn: () => setState(() => _signedIn = true));
  }
}
