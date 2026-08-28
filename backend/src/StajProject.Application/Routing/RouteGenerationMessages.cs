namespace StajProject.Application.Routing;

/// <summary>
/// Rota altyapısının API'ye taşımasına izin verilen güvenli kullanıcı mesajları.
/// Ham OSRM yanıtı, adresi veya istemci istisnası bu sözleşmenin parçası değildir.
/// </summary>
public static class RouteGenerationMessages
{
    public const string NoRoute = "Bu duraklar arasında sürüş rotası bulunamadı.";
    public const string Timeout = "Rota hesaplama servisi zamanında yanıt vermedi. Lütfen tekrar deneyin.";
    public const string Unavailable = "Rota hesaplama servisine şu anda ulaşılamıyor.";
    public const string Unknown = "Rota hesaplanamadı. Lütfen tekrar deneyin.";
}
