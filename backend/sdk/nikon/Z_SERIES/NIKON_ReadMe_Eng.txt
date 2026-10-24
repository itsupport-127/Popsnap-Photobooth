Remote SDK v2.0.0 summary

Usage
 Control the camera.

Supported cameras
 Z9, Z8, Z6III, Z7II, Z6II, Z7, Z6, Z5II, Z5, Zf, Z50II, Z50, Z30, Zfc, ZR

Environment of operation
 [Windows]
    Windows 11 64-bit edition
    * You must install "Microsoft Visual C++ Redistributable package for Visual Studio 2022".

 [macOS]
    macOS 13(Ventura)
    macOS 14(Sonoma)
    macOS 15(Sequoia)
    macOS 26(Tahoe)


Contents
 Command
    Z 30UsbMtpE_02.pdf:   Digital Camera Z30 USB Still Image Capture Device MTP Specifications Rev.2.00
    Z 50_2UsbMtpE_01.pdf: Digital Camera Z50II USB Still Image Capture Device MTP Specifications Rev.1.00
    Z 50UsbMtpE_04.pdf:   Digital Camera Z50 USB Still Image Capture Device MTP Specifications Rev.2.00
    Z 5UsbMtpE_02.pdf:    Digital Camera Z5 USB Still Image Capture Device MTP Specifications Rev.1.10
    Z 6_2UsbMtpE_02.pdf:  Digital Camera Z6II USB Still Image Capture Device MTP Specifications Rev.1.10
    Z 6UsbMtpE_04.pdf:    Digital Camera Z6 USB Still Image Capture Device MTP Specifications Rev.1.40
    Z 7_2UsbMtpE_01.pdf:  Digital Camera Z7II USB Still Image Capture Device MTP Specifications Rev.1.00
    Z 7UsbMtpE_04.pdf:    Digital Camera Z7 USB Still Image Capture Device MTP Specifications Rev.1.40
    Z 8UsbMtpE_02.pdf:    Digital Camera Z8 USB Still Image Capture Device MTP Specifications Rev.2.00
    Z 9UsbMtpE_06.pdf:    Digital Camera Z9 USB Still Image Capture Device MTP Specifications Rev.6.00
    Z fcUsbMtpE_180.pdf:  Digital Camera Zfc USB Still Image Capture Device MTP Specifications Rev.1.00
    Z 5_2UsbMtpE_01.pdf:  Digital Camera Z5II USB Still Image Capture Device MTP Specifications Rev.1.00
    Z6IIIUsbMtpE_02.pdf:  Digital Camera Z6III USB Still Image Capture Device MTP Specifications Rev.2.00
    ZfUSBMtpE_02.pdf:     Digital Camera Zf USB Still Image Capture Device MTP Specifications Rev.2.00
    ZRUsbMtpE_100.pdf:    Digital Camera ZR USB Still Image Capture Device MTP Specifications Rev.1.00

 Remote SDK
 [Common for all platforms]
    Documents
      MAID3(E).pdf: MAID basic interface specification
      MAID3-COMMON(E).pdf: MAID extended interface specification
      Sample App Guide(E).pdf: The usage of a sample app

 [Windows]
    -BinaryFile
    -HeaderFile
    -SampleApp

 [macOS]
    -BinaryFile
    -HeaderFile
    -SampleApp


Usage notes
 Please place the following three profiles from the BinaryFile folder into the directory below:
 [Windows]
   C:\Users\<User>\AppData\Local\Nikon\NXTether
 [macOS]
   ~/Library/Preferences/Nikon/NXTether

 DC_PTP_Config.config
 MaidLayer.config
 RangeValue.config


Limitations
 This module cannot control two or more cameras.

Cautions
 If software such as Camera Control Pro 2, NX Tether, or Nikon Transfer 2 (which connects a camera to a computer to control it or transfer files) is launched at the same time, Remote SDK v2.X may not operate correctly. Please exit Camera Control Pro 2, NX Tether, and Nikon Transfer 2 before connecting to the camera using Remote SDK v2.X.