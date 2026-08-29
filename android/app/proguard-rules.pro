# kotlinx.serialization keeps the generated serializers on the classes it annotates;
# R8 needs to be told not to strip them (models are only referenced reflectively by name).
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class com.ivanlee.financetracker.data.** {
    *** Companion;
}
-keepclasseswithmembers class com.ivanlee.financetracker.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.ivanlee.financetracker.data.**$$serializer { *; }

# OkHttp ships optional Conscrypt/BouncyCastle hooks it reflectively probes for.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# androidx-security-crypto pulls in com.google.crypto.tink, which is annotated with
# error-prone annotations that are compile-only and absent at runtime.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
