import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api.dart';
import '../widgets/common.dart';

/// Scans either a SecurePay payment QR (EMV) or a web sign-in QR (securepay://login?sid=...).
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _handling = false;

  Future<void> _onDetect(BarcodeCapture capture) async {
    final text = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
    if (text == null || _handling) return;
    _handling = true;
    await _controller.stop();
    try {
      final login = RegExp(r'securepay://login\?sid=([\w-]+)').firstMatch(text);
      if (login != null) {
        await _approveLogin(login.group(1)!);
      } else {
        await _pay(text);
      }
    } catch (e) {
      if (mounted) showError(context, e);
      _handling = false;
      await _controller.start();
    }
  }

  Future<void> _approveLogin(String sessionId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign in on another device?'),
        content: const Text('Only approve if you just opened the SecurePay login page yourself.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Approve')),
        ],
      ),
    );
    if (ok != true) throw ApiException(0, 'Sign-in cancelled.');
    await Api.instance.post('/auth/qr/approve', {'sessionId': sessionId});
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Approved. The other device is signed in.')));
    Navigator.of(context).pop();
  }

  Future<void> _pay(String payload) async {
    final info = Map<String, dynamic>.from(await Api.instance.post('/payments/qr/parse', {'payload': payload}) as Map);
    if (!mounted) return;
    final amountCtl = TextEditingController(text: info['amount'] ?? '');
    final fixed = info['type'] == 'dynamic';
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Pay ${info['merchant']['fullName']}', style: Theme.of(ctx).textTheme.titleLarge),
          if (info['reference'] != null) Text('Ref: ${info['reference']}'),
          const SizedBox(height: 16),
          if (fixed)
            Text(money(info['amount'], info['currency']), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w600))
          else
            TextField(
              controller: amountCtl,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: 'Amount (${info['currency']})'),
            ),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Pay')),
        ]),
      ),
    );
    if (confirmed != true || !mounted) throw ApiException(0, 'Payment cancelled.');
    final key = Api.instance.newKey();
    final result = await withMfa(context, (code) => Api.instance.post('/payments/qr/pay', {
          'payload': payload,
          if (!fixed) 'amount': amountCtl.text,
          'idempotencyKey': key,
          if (code != null) 'mfaCode': code,
        }));
    if (result == null) throw ApiException(0, 'Payment cancelled.');
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(result['status'] == 'held' ? 'Payment is under review.' : 'Paid ${info['merchant']['fullName']}.'),
    ));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan QR code')),
      body: Stack(children: [
        MobileScanner(controller: _controller, onDetect: _onDetect),
        Center(
          child: Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(20)),
          ),
        ),
        const Positioned(
          left: 0,
          right: 0,
          bottom: 40,
          child: Text('Point at a SecurePay payment or sign-in code', textAlign: TextAlign.center, style: TextStyle(color: Colors.white)),
        ),
      ]),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}
