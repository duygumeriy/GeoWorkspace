import AdminPlaceholder from '../../components/admin/AdminPlaceholder.jsx'
import { KeyIcon } from '../../components/ui/icons/index.js'

export default function PermissionsPage() {
  return (
    <AdminPlaceholder
      title="Yetkiler"
      description="Yetki kataloğunu ve rollere dağılımını görüntüleyin."
      note="Yetki kataloğu ve rol-yetki yönetimi bir sonraki aşamada burada yer alacak. Sunucu tarafı hazır: katalog ve rol yetkileri okunup güncellenebiliyor."
      Icon={KeyIcon}
    />
  )
}
