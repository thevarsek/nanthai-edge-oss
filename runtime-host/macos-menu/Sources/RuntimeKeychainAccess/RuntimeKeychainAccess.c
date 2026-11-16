#include "RuntimeKeychainAccess.h"

// The existing login Keychain needs its legacy ACL API to preserve paired Macs
// and permit explicit Keychain-approved CLI access. The Data Protection Keychain
// has a different identity/entitlement model and cannot use these ACLs.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
OSStatus NanthAIStoreCredential(CFDataRef data, Boolean trustCurrentApplication) {
    SecTrustedApplicationRef application = NULL;
    OSStatus status = errSecSuccess;
    if (trustCurrentApplication) {
        status = SecTrustedApplicationCreateFromPath(NULL, &application);
        if (status != errSecSuccess) return status;
    }
    const void *applicationValues[] = { application };
    CFArrayRef applications = CFArrayCreate(NULL, applicationValues, application ? 1 : 0, &kCFTypeArrayCallBacks);
    SecAccessRef access = NULL;
    status = SecAccessCreate(CFSTR("NanthAI Runtime device credential"), applications, &access);
    CFRelease(applications);
    if (application) CFRelease(application);
    if (status != errSecSuccess) return status;

    const void *identityKeys[] = { kSecClass, kSecAttrService, kSecAttrAccount };
    const void *identityValues[] = { kSecClassGenericPassword, CFSTR("ai.nanthai.runtime-host"), CFSTR("paired-device") };
    CFDictionaryRef identity = CFDictionaryCreate(NULL, identityKeys, identityValues, 3,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    const void *attributeKeys[] = { kSecValueData, kSecAttrAccess };
    const void *attributeValues[] = { data, access };
    CFDictionaryRef attributes = CFDictionaryCreate(NULL, attributeKeys, attributeValues, 2,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    status = SecItemUpdate(identity, attributes);
    if (status == errSecItemNotFound) {
        CFMutableDictionaryRef item = CFDictionaryCreateMutableCopy(NULL, 0, identity);
        CFDictionarySetValue(item, kSecValueData, data);
        CFDictionarySetValue(item, kSecAttrAccess, access);
        status = SecItemAdd(item, NULL);
        CFRelease(item);
    }
    CFRelease(attributes);
    CFRelease(identity);
    CFRelease(access);
    return status;
}
#pragma clang diagnostic pop
