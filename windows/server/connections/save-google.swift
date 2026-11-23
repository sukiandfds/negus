import Foundation
import Security
let bytes = FileHandle.standardInput.readDataToEndOfFile()
let attrs: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"Negus.AccountService",kSecAttrAccount as String:CommandLine.arguments[1],kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly,kSecValueData as String:bytes]
let status = SecItemAdd(attrs as CFDictionary, nil)
exit(status == errSecSuccess ? 0 : status == errSecDuplicateItem ? 2 : 1)
