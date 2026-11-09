import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api.dart';

String money(Object amount, String currency) {
  final value = amount is num ? amount : num.tryParse(amount.toString()) ?? 0;
  try {
    return NumberFormat.simpleCurrency(name: currency, decimalDigits: currency == 'JPY' ? 0 : 2).format(value);
  } catch (_) {
    return '${value.toStringAsFixed(2)} $currency';
  }
}

const currencies = ['USD', 'EUR', 'GBP', 'PKR', 'AED', 'INR', 'JPY'];

void showError(BuildContext context, Object error) {
  final msg = error is ApiException ? error.message : 'Something went wrong. Please try again.';
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
}

/// Asks for a 6-digit authenticator code. Returns null if cancelled.
Future<String?> askMfaCode(BuildContext context, String reason) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Confirm it’s you'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(reason),
          const SizedBox(height: 12),
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 22, letterSpacing: 8),
            decoration: const InputDecoration(hintText: '000000', counterText: ''),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        FilledButton(
          onPressed: () {
            if (RegExp(r'^\d{6}$').hasMatch(controller.text)) Navigator.pop(ctx, controller.text);
          },
          child: const Text('Confirm'),
        ),
      ],
    ),
  );
}

/// Runs [action]; if the API asks for step-up MFA, prompts for a code and retries.
Future<T?> withMfa<T>(BuildContext context, Future<T> Function(String? code) action) async {
  try {
    return await action(null);
  } on ApiException catch (e) {
    if (!e.needsMfa) rethrow;
    var reason = e.body?['reason'] == 'risk'
        ? 'This payment looks unusual, so we need to confirm it’s you.'
        : 'Large payments need your authenticator code.';
    while (true) {
      if (!context.mounted) return null;
      final code = await askMfaCode(context, reason);
      if (code == null) return null;
      try {
        return await action(code);
      } on ApiException catch (e2) {
        if (e2.status == 401 || e2.needsMfa) {
          reason = e2.message;
          continue;
        }
        rethrow;
      }
    }
  }
}

class TxTile extends StatelessWidget {
  const TxTile(this.tx, {super.key});
  final Map<String, dynamic> tx;

  static const _labels = {
    'deposit': 'Top-up',
    'withdrawal': 'Withdrawal',
    'transfer': 'Transfer',
    'fx': 'Exchange',
    'qr_payment': 'QR payment',
    'hold_release': 'Transfer',
    'hold_reversal': 'Refund',
  };

  @override
  Widget build(BuildContext context) {
    final incoming = tx['direction'] == 'in';
    final amount = (num.tryParse(tx['amount'].toString()) ?? 0).abs();
    final scheme = Theme.of(context).colorScheme;
    final status = tx['status'] as String;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: incoming ? Colors.green.withValues(alpha: 0.12) : scheme.surfaceContainerHighest,
        child: Icon(incoming ? Icons.south_west : Icons.north_east, size: 18, color: incoming ? Colors.green.shade700 : scheme.onSurfaceVariant),
      ),
      title: Text(tx['counterparty'] ?? tx['description'] ?? _labels[tx['kind']] ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        [_labels[tx['kind']] ?? tx['kind'], if (tx['note'] != null) tx['note'], DateFormat.MMMd().format(DateTime.parse(tx['createdAt']).toLocal())].join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text('${incoming ? '+' : '−'}${money(amount, tx['currency'])}',
              style: TextStyle(fontWeight: FontWeight.w600, color: incoming ? Colors.green.shade700 : null)),
          if (status != 'completed')
            Text(status == 'held' ? 'Under review' : 'Declined', style: TextStyle(fontSize: 11, color: status == 'held' ? Colors.orange.shade800 : scheme.error)),
        ],
      ),
    );
  }
}
