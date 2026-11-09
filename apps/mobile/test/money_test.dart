import 'package:flutter_test/flutter_test.dart';
import 'package:securepay_mobile/widgets/common.dart';

void main() {
  test('formats money with currency symbols', () {
    expect(money('12.5', 'USD'), r'$12.50');
    expect(money(1000, 'JPY'), contains('1,000'));
  });

  test('supports every API currency', () {
    expect(currencies, containsAll(['USD', 'EUR', 'GBP', 'PKR', 'AED', 'INR', 'JPY']));
  });
}
